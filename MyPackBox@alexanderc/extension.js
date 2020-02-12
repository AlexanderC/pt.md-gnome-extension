'use strict';

const ExtensionUtils = imports.misc.extensionUtils;
const GObject = imports.gi.GObject;
const Cairo = imports.cairo;
const Mainloop = imports.mainloop;
const Main = imports.ui.main;
const Lang = imports.lang;
const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;
const Util = imports.misc.util;
const Json = imports.gi.Json;
const Soup = imports.gi.Soup;
const Gio = imports.gi.Gio;
//const Gettext = imports.gettext.domain($.metadata.name);
const Config = imports.misc.config;

//const _ = Gettext.gettext;
const _ = x => x; // mock here
const $ = ExtensionUtils.getCurrentExtension();

const SHELL_MINOR = parseInt(Config.PACKAGE_VERSION.split('.')[1]);
const SETTING_REFRESH_INTERVAL = 'refresh-interval';
const SETTING_USERNAME = 'username';
const SETTING_PASSWORD = 'password';
const DEFAULT_POOL_INTERVAL = 180;

var MyPackBox = class MyPackBox extends PanelMenu.Button {
  _init() {
    super._init(0.0, $.metadata.name, false);

    // Initialize button
    PanelMenu.Button.prototype._init.call(this, 0.0);

    // Soup session (see https://bugzilla.gnome.org/show_bug.cgi?id=661323#c64)
    this._httpSession = new Soup.SessionAsync();
    Soup.Session.prototype.add_feature.call(this._httpSession, new Soup.ProxyResolverDefault());

    // Setup button
    this._label = new St.Label({ style_class: 'panel-label', text: _($.metadata.name) });
    const topBox = new St.BoxLayout();
    topBox.add_actor(this._label);
    this.actor.add_actor(topBox);
    Main.panel._centerBox.add(this.actor, { y_fill: true });
    Main.panel._menus.addMenu(this.menu);

    // Setup widget
    this._widget = new St.Bin({ style_class: 'widget' });
    const mainBox = new St.BoxLayout({ vertical: true });
    mainBox.add_actor(this._widget);
    this.menu.addActor(mainBox);

    // Load settings
    this._settings = ExtensionUtils.getSettings();
    const settingsWatcher = Lang.bind(this, function () {
      this._refresh_interval = this._settings.get_int(SETTING_REFRESH_INTERVAL) || DEFAULT_POOL_INTERVAL;
      this._username = this._settings.get_string(SETTING_USERNAME);
      this._password = this._settings.get_string(SETTING_PASSWORD);
      this.refreshUi();
    });
    this._settings.connect('changed::' + SETTING_REFRESH_INTERVAL, settingsWatcher);
    this._settings.connect('changed::' + SETTING_USERNAME, settingsWatcher);
    this._settings.connect('changed::' + SETTING_PASSWORD, settingsWatcher);
    settingsWatcher();

    // Show progress
    this.showLoadingUi();

    // Run ticker
    this.refreshUi(true);
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
        this.refresh(recurse);
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

  // async loadJsonAsync(url, cb) {
  //   let here = this;
  //   let message = Soup.Message.new('GET', url);

  //   this._httpSession.queue_message(message, function (_session, message) {
  //     let jp = new Json.Parser();
  //     jp.load_from_data(message.response_body.data, -1);
  //     cb.call(here, jp.get_root().get_object());
  //   });
  // },

  destroy() {
    this._settings.run_dispose();
    super.destroy();
  }
}

if (SHELL_MINOR > 30) {
  MyPackBox = GObject.registerClass(
    { GTypeName: 'MyPackBox' },
    MyPackBox
  );
}

let myPackBoxMenu;

function init() {
  log(`initializing ${$.metadata.name} version ${$.metadata.version}`);
}

function enable() {
  log(`enabling ${$.metadata.name} version ${$.metadata.version}`);

  myPackBoxMenu = new MyPackBox();
  Main.panel.addToStatusArea($.metadata.name, myPackBoxMenu);
}

function disable() {
  log(`disabling ${$.metadata.name} version ${$.metadata.version}`);

  if (myPackBoxMenu !== null) {
    myPackBoxMenu.destroy();
    myPackBoxMenu = null;
  }
}
