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


import St from 'gi://St';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import AccountsService from 'gi://AccountsService';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {createBox, systemRow} from '../lib/Utils.js';


const USERS_PANELS = ['gnome-users-panel.desktop', 'gnome-user-accounts-panel.desktop'];
const NAME_GAP = 8;
const LOOK_KEYS = ['user-avatar-style', 'user-avatar-size', 'user-avatar-name', 'user-avatar-click'];

export class UserAvatar {
    constructor(menu, settings) {
        this._menu = menu;
        this._settings = settings;
        this._row = systemRow(menu._grid);
        this._user = AccountsService.UserManager.get_default().get_user(GLib.get_user_name());
        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._button = null;
        this._pictureSize = 0;

        this._settings.connectObject('changed::show-user-avatar', () => this._sync(), this);
        this._sync();
    }

    destroy() {
        this._settings.disconnectObject(this);
        if (this._button)
            this._remove();

        this._themeContext = null;
        this._user = null;
        this._row = null;
        this._settings = null;
        this._menu = null;
    }

    _sync() {
        const show = this._settings.get_boolean('show-user-avatar');
        if (show && !this._button)
            this._build();
        else if (!show && this._button)
            this._remove();
    }

    _build() {
        const appSystem = Shell.AppSystem.get_default();
        this._app = USERS_PANELS.map(id => appSystem.lookup_app(id)).find(Boolean) || null;

        this._fallback = new St.Icon({icon_name: 'avatar-default-symbolic'});
        this._picture = new St.Bin({style_class: 'sanket-user-avatar', y_align: Clutter.ActorAlign.CENTER});
        this._name = new St.Label({style_class: 'sanket-user-name', y_align: Clutter.ActorAlign.CENTER});

        const content = createBox(false, 'sanket-user-box', {
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        content.add_child(this._picture);
        content.add_child(this._name);

        this._button = new St.Button({
            style_class: 'icon-button sanket-user-item',
            y_align: Clutter.ActorAlign.CENTER,
            child: content,
        });
        const owner = this._button;
        this._button.connectObject('clicked', () => this._activate(), owner);
        this._settings.connectObject(
            'changed::user-avatar-position', () => this._place(),
            ...LOOK_KEYS.flatMap(key => [`changed::${key}`, () => this._restyle()]),
            owner);
        this._user.connectObject(
            'notify::is-loaded', () => this._refresh(),
            'changed', () => this._refresh(),
            owner);
        this._menu.connectObject('open-state-changed', (_menu, open) => {
            if (open)
                this._fit();
        }, owner);
        this._themeContext.connectObject('notify::scale-factor', () => this._fit(), owner);

        this._row.add_child(this._button);
        this._place();
        this._restyle();
    }

    _remove() {
        const owner = this._button;
        [this._settings, this._user, this._menu, this._themeContext].forEach(source => source.disconnectObject(owner));
        if (!this._fallback.get_parent())
            this._fallback.destroy();
        this._button.destroy();

        this._button = null;
        this._fallback = null;
        this._picture = null;
        this._name = null;
        this._app = null;
        this._pictureSize = 0;
    }

    _place() {
        const end = this._settings.get_string('user-avatar-position') === 'end';
        this._row.set_child_at_index(this._button, end ? this._row.get_n_children() - 1 : 0);
    }

    _restyle() {
        const clickable = this._settings.get_string('user-avatar-click') === 'users' && Boolean(this._app);
        this._button.reactive = clickable;
        this._button.can_focus = clickable;
        this._name.visible = this._settings.get_string('user-avatar-style') === 'pill';
        this._update();
        this._fit();
    }

    _referenceHeight() {
        return this._row.get_children()
            .filter(child => child !== this._button && child.visible)
            .reduce((height, child) => {
                if (child.ensure_style)
                    child.ensure_style();
                return Math.max(height, child.get_preferred_height(-1)[1]);
            }, 0);
    }

    _fit() {
        const height = this._referenceHeight();
        if (height === 0)
            return;

        const scale = this._themeContext.scale_factor;
        const circle = this._settings.get_string('user-avatar-style') === 'circle';
        this._pictureSize = Math.round(height * this._settings.get_double('user-avatar-size'));
        this._picture.set_size(this._pictureSize, this._pictureSize);
        this._button.set_size(circle ? height : -1, height);

        const inset = Math.round((height - this._pictureSize) / 2 / scale);
        const rtl = this._button.get_text_direction() === Clutter.TextDirection.RTL;
        const [left, right] = rtl ? [inset + NAME_GAP, inset] : [inset, inset + NAME_GAP];
        this._button.style = circle ? 'padding: 0;' : `padding: 0 ${right}px 0 ${left}px;`;
        this._syncPicture();
    }

    _update() {
        const login = GLib.get_user_name();
        this._name.text = this._settings.get_string('user-avatar-name') === 'login'
            ? login
            : this._user.get_real_name() || login;
        this._button.accessible_name = this._name.text;
    }

    _refresh() {
        this._update();
        this._syncPicture();
    }

    _syncPicture() {
        const file = this._user.get_icon_file();
        const hasFile = Boolean(file) && GLib.file_test(file, GLib.FileTest.EXISTS);

        this._fallback.icon_size = Math.round(this._pictureSize / this._themeContext.scale_factor);
        this._picture.style = hasFile ? `background-image: url("${file}"); background-size: cover;` : null;
        if (hasFile && this._picture.child)
            this._picture.child = null;
        else if (!hasFile && !this._picture.child)
            this._picture.child = this._fallback;
    }

    _activate() {
        Main.overview.hide();
        this._menu.close();
        this._app.activate();
    }
}