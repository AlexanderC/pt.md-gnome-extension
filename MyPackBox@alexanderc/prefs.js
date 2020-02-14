const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const Lang = imports.lang;

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

function _logError(e, msg) {
  return logError(e, `[${Me.metadata.name}] ${msg}`);
}

const App = new Lang.Class({
  Name: `${Me.metadata.name}.App`,
  _row: 0,
  _init() {
    const SettingsSchema = Convenience.getSettings();

    this.main = new Gtk.Grid({
      margin: 10,
      row_spacing: 5,
      column_spacing: 10,
      column_homogeneous: false,
      row_homogeneous: false
    });
    
    const intervalField = new Gtk.SpinButton({
      adjustment: new Gtk.Adjustment({
        lower: 5,
        upper: 3600,
        step_increment: 5,
      }),
    });
    const usernameField = new Gtk.Entry({
      placeholder_text: _("your username"),
      width_request: 200,
    });
    const passwordField = new Gtk.Entry({
      placeholder_text: _("your password"),
      width_request: 200,
    });

    const intervalLabel = new Gtk.Label({
      label: _("Refresh Interval (seconds)"),
      hexpand: true,
      halign: Gtk.Align.START,
    });
    const usernameLabel = new Gtk.Label({
      label: _("Username (name)"),
      hexpand: true,
      halign: Gtk.Align.START,
    });
    const passwordLabel = new Gtk.Label({
      label: _("Password"),
      hexpand: true,
      halign: Gtk.Align.START,
    });

    this.addRow(intervalLabel, intervalField);
    this.addRow(usernameLabel, usernameField);
    this.addRow(passwordLabel, passwordField);

    SettingsSchema.bind(SETTING_REFRESH_INTERVAL, intervalField, 'value', Gio.SettingsBindFlags.DEFAULT);
    SettingsSchema.bind(SETTING_USERNAME, usernameField, 'text', Gio.SettingsBindFlags.DEFAULT);
    SettingsSchema.bind(SETTING_PASSWORD, passwordField, 'text', Gio.SettingsBindFlags.DEFAULT);

    this.main.show_all();
  },

  addRow(label, input) {
    this.main.attach(label, 0, this._row, 1, 1);
    this.main.attach(input, 1, this._row, 1, 1);
    this._row++;
  },
});

function init() {
  // Convenience.initTranslations();
}

function buildPrefsWidget() {
  try {
    let widget = new App();
    return widget.main;
  } catch (e) {
    _logError(e, 'Failed to initialize settings page');
  }
}
