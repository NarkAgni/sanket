/*
* Sanket GNOME Extension
* Copyright (C) 2026 NarkAgni
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program. If not, see <https://www.gnu.org/licenses/>.
*/


import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';


const DoNotDisturbToggle = GObject.registerClass(
class DoNotDisturbToggle extends QuickToggle {
    _init() {
        super._init({
            title: _('Do Not Disturb'),
            iconName: 'notifications-disabled-symbolic',
            toggleMode: true,
        });

        this._settings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._settings.bind('show-banners', this, 'checked', Gio.SettingsBindFlags.INVERT_BOOLEAN);
        this.connect('destroy', () => {
            Gio.Settings.unbind(this, 'checked');
            this._settings = null;
        });
    }
});

export class DoNotDisturb {
    constructor() {
        this._indicator = new SystemIndicator();
        this._indicator.quickSettingsItems.push(new DoNotDisturbToggle());
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    destroy() {
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
        this._indicator = null;
    }
}