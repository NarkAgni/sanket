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


import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {addGroup} from './PrefsWidgets.js';
import {COFFEE_URL, imageOrIcon, openUrl} from './HeaderBar.js';


const REPOSITORY = 'https://github.com/narkagni/sanket';
const CRYPTO = [
    ['Bitcoin (BTC)', 'security-high-symbolic', '1GSHkxfhYjk1Qe4AQSHg3aRN2jg2GQWAcV'],
    ['Ethereum (ETH)', 'emblem-shared-symbolic', '0xf43c3f83e53495ea06676c0d9d4fc87ce627ffa3'],
    ['Tether (USDT - TRC20)', 'security-medium-symbolic', 'THnqG9nchLgaf1LzGK3CqdmNpRxw59hs82'],
];

function linkRow(window, title, subtitle, iconName, url) {
    const row = new Adw.ActionRow({title, subtitle, icon_name: iconName, activatable: true});
    row.add_suffix(new Gtk.Image({
        icon_name: 'adw-external-link-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['dim-label'],
    }));
    row.connect('activated', () => openUrl(window, url));
    return row;
}

function buildHero(prefs, page) {
    const version = prefs.metadata['version-name'];
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        halign: Gtk.Align.CENTER,
        margin_top: 24,
        margin_bottom: 12,
    });

    box.append(imageOrIcon(`${prefs.path}/icons/logo.svg`, 'preferences-system-notifications-symbolic', 128));
    box.append(new Gtk.Label({
        label: '<span size="xx-large" weight="bold">Sanket</span>',
        use_markup: true,
        margin_top: 8,
    }));
    box.append(new Gtk.Label({
        label: _('A floating notification island and a calmer calendar for GNOME Shell'),
        css_classes: ['dim-label'],
        margin_bottom: 4,
    }));
    box.append(new Gtk.Label({
        label: version ? `${_('Version')} ${version}  •  GPL-3.0` : 'GPL-3.0',
        css_classes: ['dim-label', 'caption'],
    }));

    const row = new Adw.ActionRow();
    row.set_child(box);
    addGroup(page).add(row);
}

function buildCredits(page) {
    const group = addGroup(page, _('Credits'));
    group.add(new Adw.ActionRow({
        title: 'Narkagni',
        subtitle: _('Author &amp; Maintainer'),
        icon_name: 'avatar-default-symbolic',
    }));
    group.add(new Adw.ActionRow({
        title: _('Features'),
        subtitle: _('Notification island below Quick Settings · Pinned notifications · Toggles that morph into circles · Stacked and two-column calendar · Analog world clocks · Weather card · Smooth animations everywhere'),
        icon_name: 'starred-symbolic',
    }));
    group.add(new Adw.ActionRow({
        title: _('Disclaimer'),
        subtitle: _('Sanket is an independent open-source project.'),
        icon_name: 'dialog-information-symbolic',
    }));
}

function buildSupport(page, window) {
    const group = addGroup(page, _('Support Development'),
        _('If you enjoy Sanket, consider buying me a coffee ☕ or sending crypto!'));
    group.add(linkRow(window, _('Buy Me a Coffee'), 'buymeacoffee.com/narkagni', 'emoji-food-symbolic', COFFEE_URL));

    CRYPTO.forEach(([coin, iconName, address]) => {
        const row = new Adw.ActionRow({
            title: coin,
            subtitle: address.length > 24 ? `${address.substring(0, 12)}…${address.slice(-8)}` : address,
            icon_name: iconName,
        });
        const copy = new Gtk.Button({
            icon_name: 'edit-copy-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'circular'],
            tooltip_text: _('Copy address'),
        });
        copy.connect('clicked', () => {
            window.get_display().get_clipboard().set_content(Gdk.ContentProvider.new_for_value(address));
            window.add_toast(new Adw.Toast({title: _('Address copied!'), timeout: 2}));
        });
        row.add_suffix(copy);
        group.add(row);
    });
}

export function buildAboutPage(prefs, window) {
    const page = new Adw.PreferencesPage({
        title: _('About'),
        icon_name: 'help-about-symbolic',
    });

    buildHero(prefs, page);
    addGroup(page, _('Links')).add(
        linkRow(window, _('GitHub Repository'), 'github.com/narkagni/sanket', 'system-software-install-symbolic', REPOSITORY));
    buildCredits(page);
    buildSupport(page, window);

    window.add(page);
}