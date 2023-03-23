const Main = imports.ui.main;
const { Gio, GObject } = imports.gi;
const QuickSettings = imports.ui.quickSettings;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Util = Me.imports.util;

var SnxToggle = GObject.registerClass(
  class SnxToggle extends QuickSettings.QuickMenuToggle {
    _init(hasTunsnxDevice = false) {
      const config = {
        toggleMode: true,
        hasMenu: true,
        checked: hasTunsnxDevice
      };

      if (Util.getGnomeShellVersion() > 43) {
        config.title = Util.CONSTANTS['SNX_LABEL'];
      } else {
        config.label = Util.CONSTANTS['SNX_LABEL'];
      }

      super._init(config);

      this.icon_name = hasTunsnxDevice
        ? Util.CONSTANTS['ENABLED_VPN_ICON']
        : Util.CONSTANTS['DISABLED_VPN_ICON'];

      this.previousCancellable = null;
      this._mainItemsSection = new PopupMenu.PopupMenuSection();
      this._separator = new PopupMenu.PopupSeparatorMenuItem('Connector');

      this._popupSwitchMenuItem = new PopupMenu.PopupSwitchMenuItem(
        Util.CONSTANTS['SNX_LABEL_EXTENDED'],
        this.checked
      );

      this._mainItemsSection.addMenuItem(this._popupSwitchMenuItem);
      this.menu.setHeader(Util.CONSTANTS['ENABLED_VPN_ICON'], _('VPN'));
      this.menu.addMenuItem(this._mainItemsSection);
      this.menu.addMenuItem(this._separator);

      this.connectObject(
        'clicked',
        () => this._toggleMode().catch(logError),
        this
      );

      this._popupSwitchMenuItem.connect('toggled', () =>
        this._toggleMode().catch(logError)
      );

      this.connect('popup-menu', () => this.menu.open());

      this.bind_property(
        'checked',
        this._popupSwitchMenuItem._switch,
        'state',
        GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.BIDIRECTIONAL
      );
    }

    /**
     *
     * @param {string} loginResponse
     */
    _addSessionParameters(loginResponse) {
      this._removeSessionParameters();
      const sessionParams = Util.parseSessionParameters(loginResponse);

      sessionParams.forEach((session) =>
        this.menu.addMenuItem(
          new PopupMenu.PopupMenuItem(
            `${session.label.trim()} : ${session.value.trim()}`
          )
        )
      );

      this._separator.label.text = 'Session parameters';
    }

    _removeSessionParameters() {
      const items = this.menu._getMenuItems();
      items.forEach((item) => {
        if (item instanceof PopupMenu.PopupMenuItem) {
          item.destroy();
        }
      });

      this._separator.label.text = 'Connector';
    }

    /**
     *
     * @param {Gio.Cancellable} cancellable
     * @returns void
     */
    async _handleCheckedAction(cancellable) {
      try {
        const passwordPromptOutput = await Util.execCommunicate(
          [
            'zenity',
            '--password',
            '--title=SNX VPN Authentication ',
            '--timeout=20'
          ],
          null,
          cancellable
        );

        if (!passwordPromptOutput) {
          throw new Gio.IOErrorEnum({
            code: Gio.IOErrorEnum.FAILED,
            message: 'No password'
          });
        }

        const stdout = await Util.execCommunicate(
          [`${Me.dir.get_path()}/bridge-snx-cli.sh`, passwordPromptOutput],
          null
        );

        const loginResponse = stdout
          .split('Please enter your password:')
          .pop()
          .trimEnd()
          .trimStart();

        if (!loginResponse.includes('Session parameters:')) {
          throw new Gio.IOErrorEnum({
            code: Gio.IOErrorEnum.FAILED,
            message: loginResponse
          });
        }

        this._addSessionParameters(loginResponse);

        Util.VPN_NOTIFY(
          _('Successfully connected to VPN'),
          Util.CONSTANTS['ENABLED_VPN_ICON']
        );
      } catch (error) {
        logError(error);
        if (error.code !== 14) {
          Util.VPN_NOTIFY(
            _(error.message),
            Util.CONSTANTS['NO_ROUTE_VPN_ICON']
          );
        }

        this.checked = false;
        this.icon_name = Util.CONSTANTS['DISABLED_VPN_ICON'];
      }
    }

    /**
     *
     * @param {Gio.Cancellable} cancellable
     * @returns void
     */
    async _handleUncheckedAction(cancellable) {
      try {
        const output = await Util.execCommunicate(
          ['/usr/bin/snx', '-d'],
          null,
          cancellable
        );

        Util.VPN_NOTIFY(_(output), Util.CONSTANTS['DISCONNECTED_VPN_ICON']);
      } catch (error) {
        logError(error);
        Util.VPN_NOTIFY(_(error.message), Util.CONSTANTS['NO_ROUTE_VPN_ICON']);
      }
    }

    async _toggleMode() {
      if (this.previousCancellable) {
        this.previousCancellable.cancel();
      }

      const cancellable = new Gio.Cancellable();
      this.icon_name = Util.CONSTANTS['ACQUIRING_VPN_ICON'];

      if (this.checked) {
        this._handleCheckedAction(cancellable);
        this.previousCancellable = cancellable;
        return;
      }

      this._handleUncheckedAction(cancellable);
      this.previousCancellable = cancellable;
    }
  }
);
