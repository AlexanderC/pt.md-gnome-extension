'use strict';

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const PolicyType = imports.gi.Gtk.PolicyType;
const Util = imports.misc.util;
const Json = imports.gi.Json;
const Soup = imports.gi.Soup;
const MessageTray = imports.ui.messageTray;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const CheckBox = imports.ui.checkBox.CheckBox;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const Gettext = imports.gettext;
//const _ = Gettext.domain(Me.metadata.name).gettext;
const _ = x => x;

// Constants
const API_BASE = 'http://postterminal.xyz';
const SETTING_REFRESH_INTERVAL = 'refresh-interval';
const SETTING_USERNAME = 'username';
const SETTING_PASSWORD = 'password';
const DEFAULT_POOL_INTERVAL = 60;

function _log(msg) {
  return log(`[${Me.metadata.name}] ${msg}`);
}

function _logError(e, msg) {
  return logError(e, `[${Me.metadata.name}] ${msg}`);
}

const MyPackBox = Lang.Class({
  Name: Me.metadata.name,
  Extends: PanelMenu.Button,

  _topBox: null,
  _httpSession: null,
  _menuRoot: null,
  _menu: null,
  _menuBox: null,
  _widgetScroll: null,
  _widget: null,
  _settingsMenuBox: null,
  _settingsMenuItem: null,
  _settings: null,
  _settingsConnectIds: [],
  _token: null,
  _newOrders: [],
  _activeTimeouts: {},

  destroy() {
    for (const settingConnectId of this._settingsConnectIds) {
      this._settings.disconnect(settingConnectId);
    }
    this._settingsConnectIds = [];

    for (const lid of Object.keys(this._activeTimeouts)) {
      Mainloop.source_remove(lid);
    }
    this._activeTimeouts = {};
    
    this._token = null; // @todo whould we reset it? e.g. after lock screen?
    this._httpSession = null;
    this._newOrders = []; // @todo whould we reset it? e.g. after lock screen?

    // Call parent
    this.parent();
  },

  _init() {
    this.parent(0.0, Me.metadata.name);

    // Setup top bar button
    this._topBox = new St.BoxLayout({ style_class: 'button' });
    const label = new St.Label({
      y_align: Clutter.ActorAlign.CENTER,
      text: _(Me.metadata.name),
    });
    this._topBox.add_child(label);
    this.actor.add_child(this._topBox);

    // Setup widget
    this._menuRoot = new PopupMenu.PopupBaseMenuItem({
      style_class: 'menu',
      reactive: false,
    });
    this._menu = new St.Bin({
      style_class: 'menu-bin',
    });
    this._menuBox = new St.BoxLayout({
      vertical: true,
      style_class: 'menu-box',
    });
    this._widgetScroll = new St.ScrollView({
      style_class: 'widget-scroll',
      overlay_scrollbars: true,
      vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
    });
    this._widget = new PopupMenu.PopupMenuSection({
      style_class: 'widget',
    });
    this._widgetScroll.add_actor(this._widget.actor);
    this._menuBox.add_actor(this._widgetScroll);
    this._menu.set_child(this._menuBox);
    this._menuRoot.actor.add_actor(this._menu);
    this.menu.addMenuItem(this._menuRoot);
    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    this._settingsMenuBox = new PopupMenu.PopupBaseMenuItem({
      style_class: 'menu',
      reactive: false,
    });
    this._settingsMenuItem = Main.panel.statusArea.aggregateMenu._system
      ._createActionButton(
        'preferences-system-symbolic',
        _(`${Me.metadata.name} Settings`)
      );
    this._settingsMenuItem.set_label(_('Settings'));
    this._settingsMenuItem.connect('clicked', Lang.bind(this, this._openSettings));
    this._settingsMenuBox.actor.add_actor(this._settingsMenuItem);
    this.menu.addMenuItem(this._settingsMenuBox);

    // Load settings
    this._settings = Convenience.getSettings();
    const settingsWatcher = Lang.bind(this, function () {
      this._refreshInterval = this._settings.get_int(SETTING_REFRESH_INTERVAL) || DEFAULT_POOL_INTERVAL;
      this._username = this._settings.get_string(SETTING_USERNAME);
      this._password = this._settings.get_string(SETTING_PASSWORD);

      _log(`SETTING_REFRESH_INTERVAL=${this._refreshInterval}`);
      _log(`SETTING_USERNAME=${this._username}`);
      _log(`SETTING_PASSWORD=${this._password}`);
    });
    this._settingsConnectIds.push(
      this._settings.connect('changed::' + SETTING_REFRESH_INTERVAL, settingsWatcher),
      this._settings.connect('changed::' + SETTING_USERNAME, settingsWatcher),
      this._settings.connect('changed::' + SETTING_PASSWORD, settingsWatcher),
    );
    settingsWatcher();

    // Show progress
    this.showLoadingUi();

    // Run ticker
    this._wrapPromise(this.refreshUi(true), 'Failed to refresh widget UI');
  },

  async refreshUi(recurse) {
    _log('Attempt to refresh UI');

    if (this.assertCredentials()) {
      if (!this._token) {
        try {
          await this.authorize();
        } catch (e) {
          _logError(e, 'Failed to authorize');
          Main.notify(
            Me.metadata.name,
            _('Failed to obtain authorization token')
          );
        }
      }

      // assure not failed to authorize...
      if (this._token) {
        try {
          // @todo implement filtered listing
          const data = await this.rpc('list');
          this.rebuildCurrentUi(data);
        } catch (e) {
          _logError(e, 'Failed to fetch packages');
          Main.notify(
            Me.metadata.name,
            _('Failed to fetch packages. Please check your credentials!')
          );
        }
      }
    }

    if (recurse) {
      _log(`Recurse in ${this._refreshInterval} seconds...`);

      const lid = Mainloop.timeout_add_seconds(this._refreshInterval, Lang.bind(this, function () {
        Mainloop.source_remove(lid);
        delete this._activeTimeouts[lid];
        this._wrapPromise(this.refreshUi(recurse), 'Failed to refresh widget UI');
      }));
      this._activeTimeouts[lid] = true;
    }
  },

  cleanupWidget() {
    this._widget._getMenuItems()
      .forEach(item => item.destroy());
  },

  assertCredentials() {
    if (!this._username || !this._password) {
      _log('Missing credentials!');

      this.cleanupWidget();
      this.textMenuItem(_('You need to set credentials first'));
      return false;
    }

    return true;
  },

  showLoadingUi() {
    this.cleanupWidget();
    this.textMenuItem(_('Loading...'));
  },

  rebuildCurrentUi(data) {
    this.cleanupWidget();

    if (data.items.length <= 0) {
      this.textMenuItem(_('You have no packages...'));
      return;
    }
    
    let newOrders = 0;
    this.packMenuHeader();
    for (const item of data.items) {
      if (!item.isPaid && this._newOrders.indexOf(item.orderID) === -1) {
        this._newOrders.push(item.orderID);
        newOrders++;
      }
      
      this.packMenuItem(item);
    }

    if (newOrders > 0) {
      Main.notify(
        Me.metadata.name,
        _('You have %s new package[s] in arrived!').format(newOrders)
      );
    }
  },

  packMenuHeader() {
    const menuBox = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      style_class: 'package-item',
    });
    const menuItem = new St.BoxLayout({
      style_class: 'package-row',
    });

    let idx = 0;
    for (const name of [
      'PAYMENT', 'STATUS', 'DATE', 
      'CELL', 'TIME', 'SHOP', 'GOODS',
    ]) {
      const label = new St.Label({
        y_align: Clutter.ActorAlign.CENTER,
        text: _(name),
      });
      menuItem.insert_child_at_index(label, idx++);
    }

    menuBox.actor.add_actor(menuItem);
    this._widget.addMenuItem(menuBox);

    return menuBox;
  },

  packMenuItem(item) {
    const menuBox = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      style_class: 'package-item',
    });
    const menuItem = new St.BoxLayout({
      style_class: 'package-row',
    });

    if (!item.isPaid) {
      const payButton = Main.panel.statusArea.aggregateMenu._system._createActionButton(
        `pay-packege-${item.orderID}`,
        _('Pay')
      );
      payButton.add_style_class_name('pay-button');
      payButton.set_label(_('Pay'));
      payButton.connect('clicked', Lang.bind(this, async function() {
        try {
          const paidLabel = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            text: _('Paying...'),
          });
          menuItem.remove_child(menuItem.get_child_at_index(0));
          menuItem.insert_child_at_index(paidLabel, 0);

          const payHtml = await this.rpc('pay', [ item.orderID ]);
          const tmpFile = Gio.file_new_tmp(`${Me.metadata.name}-XXXXXX-payframe-${item.orderID}.html`)[0];
          _log(`Output payframe content into: ${tmpFile.get_path()}`);
          tmpFile.replace_contents(payHtml, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
          this.menu.actor.hide();
          Util.spawn([
            "xdg-open",
            tmpFile.get_path(),
          ]);
        } catch (e) {
          _logError(e, `Failed prepare payframe for order: ${item.orderID}`);
        }
      }));
      menuItem.insert_child_at_index(payButton, 0);
    } else {
      const paidLabel = new St.Label({
        y_align: Clutter.ActorAlign.CENTER,
        text: _('Paid'),
      });
      menuItem.insert_child_at_index(paidLabel, 0);
    }

    let idx = 1;

    const statusLabel = new St.Label({
      y_align: Clutter.ActorAlign.CENTER,
      text: _(item.orderStateCode),
    });
    menuItem.insert_child_at_index(statusLabel, idx++);

    const dateLabel = new St.Label({
      y_align: Clutter.ActorAlign.CENTER,
      text: this._formatDate(item.orderDate),
    });
    menuItem.insert_child_at_index(dateLabel, idx++);

    const cellLabel = new St.Label({
      y_align: Clutter.ActorAlign.CENTER,
      text: (item.cellCode
        ? `${item.cellCode} (${item.cellCategoryName})`
        : _('N/A')),
    });
    menuItem.insert_child_at_index(cellLabel, idx++);

    const cellTimeLabel = new St.Label({
      y_align: Clutter.ActorAlign.CENTER,
      text: (item.cellTimeEnd
        ? `${this._formatDate(item.cellTimeBegin)}-${this._formatDate(item.cellTimeEnd)}`
        : _('N/A')),
    });
    menuItem.insert_child_at_index(cellTimeLabel, idx++);

    const shopLabel = new St.Label({
      y_align: Clutter.ActorAlign.CENTER,
      text: item.shopCompanyName || _('N/A'),
    });
    menuItem.insert_child_at_index(shopLabel, idx++);

    const goodsNameLabel = new St.Label({
      y_align: Clutter.ActorAlign.CENTER,
      text: item.goodsName,
    });
    menuItem.insert_child_at_index(goodsNameLabel, idx++);
    
    menuBox.actor.add_actor(menuItem);
    this._widget.addMenuItem(menuBox);

    return menuBox;
  },

  textMenuItem(text) {
    const menuBox = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      style_class: 'text-item',
    });
    const menuItem = new PopupMenu.PopupMenuItem(text);

    menuBox.actor.add_actor(menuItem.actor);
    this._widget.addMenuItem(menuBox);

    return menuBox;
  },

  async authorize() {
    const { token } = await this._request(
      'POST',
      `${API_BASE}/token`,
      {
        username: this._username,
        password: this._password,
      }
    );
    this._token = token;
  },

  async rpc(method, params = []) {
    const response = await this._request(
      'POST',
      `${API_BASE}/rpc`,
      {
        jsonrpc: '2.0',
        id: 0,
        method,
        params,
      }
    );

    if (response.error) {
      throw new Error(
        `${response.error.message}: ${response.error.data.message}`
      );
    }

    return response.result;
  },

  async _request(method, url, data) {
    if (!this._httpSession) {
      // Soup session (see https://bugzilla.gnome.org/show_bug.cgi?id=661323#c64)
      this._httpSession = new Soup.SessionAsync();
      Soup.Session.prototype.add_feature.call(this._httpSession, new Soup.ProxyResolverDefault());
    }

    return new Promise((resolve, reject) => {
      const body = JSON.stringify(data);
      const message = Soup.Message.new(method, url);
      message.set_request(
        'application/json',
        Soup.MemoryUse.COPY,
        body,
        //body.length,
      );

      if (this._token) {
        message.request_headers.append('Authorization', `Bearer ${this._token}`);
      }

      _log(`Send ${method} request to ${url} w/ data=${body} [${this._token ? 'AUTH' : 'ANON'}]`);

      this._httpSession.queue_message(message, Lang.bind(this, function (_session, response) {
        if (response.status_code !== Soup.KnownStatusCode.OK) {
          return reject(new Error(
            `Request failed w/ status ${response.status_code}: ${response.reason_phrase}`
          ));
        }

        try {
          if (!message.response_body.data) {
            return reject(new Error('Missing response body'));
          }

          _log(`Response from ${method}::${url} w/ length of ${message.response_body.data.length} bytes`);
          resolve(JSON.parse(message.response_body.data));
        } catch (e) {
          reject(e);
        }
      }));
    });
  },

  _openSettings() {
    this.menu.actor.hide();
    Util.spawn([
      "gnome-shell-extension-prefs",
      Me.uuid,
    ]);
  },

  _wrapPromise(p, msg) {
    return p.catch(e => _logError(e, msg));
  },

  _formatDate(str, full = true) {
    const date = new Date(str);

    if (!full) {
      return `${date.getDate()}/${date.getMonth() + 1}`;
    }

    return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
  }
});

var myPackBoxMenu;

function init() {
  _log(`initializing ${Me.metadata.name} version ${Me.metadata.version}`);

  // Convenience.initTranslations();
}

function enable() {
  _log(`enabling ${Me.metadata.name} version ${Me.metadata.version}`);

  try {
    myPackBoxMenu = new MyPackBox();
  } catch (e) {
    _logError(e, 'Unable to initialize extension');
  }

  if (myPackBoxMenu) {
    Main.panel.addToStatusArea(Me.metadata.name, myPackBoxMenu);
  }
}

function disable() {
  _log(`disabling ${Me.metadata.name} version ${Me.metadata.version}`);

  if (myPackBoxMenu !== null) {
    myPackBoxMenu.destroy();
    myPackBoxMenu = null;
  }
}
