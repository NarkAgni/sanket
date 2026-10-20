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


import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {onSettingChanged} from './SettingsSignals.js';


export function makeGroupResetButton(settings, keys) {
    const box = new Gtk.Box({spacing: 8, valign: Gtk.Align.CENTER});
    box.append(new Gtk.Separator({
        orientation: Gtk.Orientation.VERTICAL,
        margin_top: 8,
        margin_bottom: 8,
    }));

    const button = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'circular'],
        tooltip_text: _('Reset all in this group'),
    });

    const isChanged = key => !settings.get_value(key).equal(settings.get_default_value(key));
    const sync = () => {
        const changed = keys.some(isChanged);
        button.set_sensitive(changed);
        button.set_opacity(changed ? 1 : 0.3);
    };

    button.connect('clicked', () => keys.forEach(key => settings.reset(key)));
    keys.forEach(key => onSettingChanged(settings, key, sync));
    sync();

    box.append(button);
    return box;
}