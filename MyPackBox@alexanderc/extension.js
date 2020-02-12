'use strict';

const { Clutter, Gio, Gtk, GLib, GObject, Soup, St } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Mainloop = imports.mainloop;
const Main = imports.ui.main;
const Lang = imports.lang;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;
const Util = imports.misc.util;
const Json = imports.gi.Json;
//const Gettext = imports.gettext.domain(Me.metadata.name);
//const _ = Gettext.gettext;
const _ = x => x; // mock here
const Me = ExtensionUtils.getCurrentExtension();

const SETTING_REFRESH_INTERVAL = 'refresh-interval';
const SETTING_USERNAME = 'username';
const SETTING_PASSWORD = 'password';
const DEFAULT_POOL_INTERVAL = 180;

const MyPackBox = GObject.registerClass(class MyPackBox extends PanelMenu.Button {
  _init() {
    super._init(0.0, Me.metadata.name, false);

    // Initialize button
    PanelMenu.Button.prototype._init.call(this, 0.0);

    // Soup session (see https://bugzilla.gnome.org/show_bug.cgi?id=661323#c64)
    this._httpSession = new Soup.SessionAsync();
    Soup.Session.prototype.add_feature.call(this._httpSession, new Soup.ProxyResolverDefault());

    // Setup button
    this._label = new St.Label({
      y_align: Clutter.ActorAlign.CENTER,
      text: _(Me.metadata.name),
    });
    const topBox = new St.BoxLayout();
    topBox.add_actor(this._label);
    this.add_actor(topBox);
    Main.panel._menus.addMenu(this.menu);

    // Setup widget
    this._widget = new St.Bin({ style_class: 'widget' });
    const _widget = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
    });
    _widget.actor.add_actor(this._widget);
    this.menu.addMenuItem(_widget);

    // Load settings
    this._settings = ExtensionUtils.getSettings();
    const settingsWatcher = Lang.bind(this, function () {
      this._refresh_interval = this._settings.get_int(SETTING_REFRESH_INTERVAL) || DEFAULT_POOL_INTERVAL;
      this._username = this._settings.get_string(SETTING_USERNAME);
      this._password = this._settings.get_string(SETTING_PASSWORD);
      this.refreshUi().catch(e => logError(e, 'Failed to refresh widget UI'));
    });
    this._settings.connect('changed::' + SETTING_REFRESH_INTERVAL, settingsWatcher);
    this._settings.connect('changed::' + SETTING_USERNAME, settingsWatcher);
    this._settings.connect('changed::' + SETTING_PASSWORD, settingsWatcher);
    settingsWatcher();

    // Show progress
    this.showLoadingUi();

    // Run ticker
    this.refreshUi(true).catch(e => logError(e, 'Failed to refresh widget UI'));
  }

  async refreshUi(recurse) {
    // If no username or password it doesn't make sense
    // to go further. Also stop the 
    if (!this._username || !this._password) {
      this.destroyWidget();
      this._widget.set_child(new St.Label({ text: _('You need to set credentials first') }));
    } else {
      // @todo Load and data
      this.rebuildCurrentUi({});
    }

    if (recurse) {
      Mainloop.timeout_add_seconds(this._refresh_interval, Lang.bind(this, function () {
        this.refresh(recurse).catch(e => logError(e, 'Failed to refresh widget UI'));
      }));
    }
  }

  destroyWidget() {
    if (this._widget.get_child() != null) {
      this._widget.get_child().destroy();
    }
  }

  showLoadingUi() {
    this.destroyWidget();
    this._widget.set_child(new St.Label({ text: _('Loading...') }));
  }

  rebuildCurrentUi(data) {
    this.destroyWidget();
    // @todo Handle data
  }

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
  // }
});

//MyPackBox

var myPackBoxMenu;

function init() {
  log(`initializing ${Me.metadata.name} version ${Me.metadata.version}`);

  // ExtensionUtils.initTranslations(Me.metadata.name);
}

function enable() {
  log(`enabling ${Me.metadata.name} version ${Me.metadata.version}`);

  try {
    myPackBoxMenu = new MyPackBox();
  } catch (e) {
    logError(e, 'Unable to initialize extension');
  }

  if (myPackBoxMenu) {
    Main.panel.addToStatusArea(Me.metadata.name, myPackBoxMenu);
  }
}

function disable() {
  log(`disabling ${Me.metadata.name} version ${Me.metadata.version}`);

  if (myPackBoxMenu !== null) {
    myPackBoxMenu.destroy();
    myPackBoxMenu = null;
  }
}
