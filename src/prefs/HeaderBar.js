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
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


export const COFFEE_URL = 'https://buymeacoffee.com/narkagni';

function findHeaderBar(widget) {
    if (widget.get_show_end_title_buttons && widget.pack_start)
        return widget;

    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        const found = findHeaderBar(child);
        if (found)
            return found;
    }
    return null;
}

export function imageOrIcon(path, iconName, size) {
    const image = GLib.file_test(path, GLib.FileTest.EXISTS)
        ? Gtk.Image.new_from_file(path)
        : new Gtk.Image({icon_name: iconName});
    image.set_pixel_size(size);
    return image;
}

export function openUrl(window, url) {
    Gio.AppInfo.launch_default_for_uri(url, window.get_display().get_app_launch_context());
}

export function setupHeaderBar(prefs, window) {
    window.set_search_enabled(true);

    const headerBar = findHeaderBar(window);
    if (!headerBar)
        return;

    const button = new Gtk.Button({
        child: imageOrIcon(`${prefs.path}/icons/bmc-logo.svg`, 'emoji-food-symbolic', 24),
        tooltip_text: _('Buy Me a Coffee'),
        valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'image-button'],
    });
    button.connect('clicked', () => openUrl(window, COFFEE_URL));
    headerBar.pack_start(button);
}