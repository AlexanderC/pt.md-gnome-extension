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
const SETTING_REFRESH_INTERVAL = 'refresh-interval';
const SETTING_USERNAME = 'username';
const SETTING_PASSWORD = 'password';
const DEFAULT_POOL_INTERVAL = 180;

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
  _settings: null,
  _settingsConnectIds: [],

  destroy() {
    for (const settingConnectId of this._settingsConnectIds) {
      this._settings.disconnect(settingConnectId);
    }
    this._settingsConnectIds = [];

    // Call parent
    this.parent();
  },

  _init() {
    this.parent(0.0, Me.metadata.name);


    // Soup session (see https://bugzilla.gnome.org/show_bug.cgi?id=661323#c64)
    this._httpSession = new Soup.SessionAsync();
    Soup.Session.prototype.add_feature.call(this._httpSession, new Soup.ProxyResolverDefault());

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
      reactive: false
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

    // Load settings
    this._settings = Convenience.getSettings();
    const settingsWatcher = Lang.bind(this, function () {
      this._refresh_interval = this._settings.get_int(SETTING_REFRESH_INTERVAL) || DEFAULT_POOL_INTERVAL;
      this._username = this._settings.get_string(SETTING_USERNAME);
      this._password = this._settings.get_string(SETTING_PASSWORD);
      this._wrapPromise(this.refreshUi(), 'Failed to refresh widget UI');
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
      // @todo Load and data
      this.rebuildCurrentUi({});
    }

    if (recurse) {
      _log(`Recurse in ${this._refresh_interval} seconds...`);
      const lid = Mainloop.timeout_add_seconds(this._refresh_interval, Lang.bind(this, function () {
        this._wrapPromise(this.refreshUi(recurse), 'Failed to refresh widget UI');
        Mainloop.source_remove(lid);
      }));
    }
  },

  cleanupWidget() {
    this._widget._getMenuItems()
      .forEach(item => item.destroy());
  },

  textMenuItem(text) {
    const menuItem = new PopupMenu.PopupMenuItem(text);
    this._widget.addMenuItem(menuItem);
    return menuItem;
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
    // @todo Handle data
  },

  _wrapPromise(p, msg) {
    return p.catch(e => _logError(e, msg));
  },

  // load_json_async(url, params, fun) {
  //   if (_httpSession === undefined) {
  //     _httpSession = new Soup.Session();
  //     _httpSession.user_agent = this.user_agent;
  //   } else {
  //     // abort previous requests.
  //     _httpSession.abort();
  //   }

  //   let message = Soup.form_request_new_from_hash('GET', url, params);

  //   _httpSession.queue_message(message, Lang.bind(this, function (_httpSession, message) {
  //     try {
  //       if (!message.response_body.data) {
  //         fun.call(this, 0);
  //         return;
  //       }
  //       let jp = JSON.parse(message.response_body.data);
  //       fun.call(this, jp);
  //     } catch (e) {
  //       fun.call(this, 0);
  //       return;
  //     }
  //   }));
  //   return;
  // },
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
