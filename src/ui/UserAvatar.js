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
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import AccountsService from 'gi://AccountsService';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import {Avatar} from 'resource:///org/gnome/shell/ui/userWidget.js';
import {QuickMenuToggle} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {createBox, systemItem, systemRow} from '../lib/Utils.js';


const USERS_PANELS = ['gnome-users-panel.desktop', 'gnome-user-accounts-panel.desktop'];
const NAME_GAP = 8;
const LOOK_KEYS = ['user-avatar-style', 'user-avatar-size', 'user-avatar-name', 'user-avatar-click'];
const SWITCH_AVATAR_SIZE = 32;
const LOGIND = ['org.freedesktop.login1', '/org/freedesktop/login1', 'org.freedesktop.login1.Manager'];

function createToggleMenu(sourceActor) {
    const probe = new QuickMenuToggle();
    const ToggleMenu = probe.menu.constructor;
    probe.destroy();
    return new ToggleMenu(sourceActor);
}

function otherUsers() {
    const manager = AccountsService.UserManager.get_default();
    if (!manager.is_loaded)
        return [];

    const login = GLib.get_user_name();
    return manager.list_users()
        .filter(user => user.is_loaded && !user.system_account && !user.locked && user.get_user_name() !== login)
        .sort((first, second) => displayName(first).localeCompare(displayName(second)));
}

function displayName(user) {
    return user.get_real_name() || user.get_user_name();
}

function activateSession(id) {
    if (!id) {
        SystemActions.getDefault().activateSwitchUser();
        return;
    }

    if (Main.screenShield)
        Main.screenShield.lock(false);
    Gio.DBus.system.call(...LOGIND, 'ActivateSession', new GLib.Variant('(s)', [id]), null,
        Gio.DBusCallFlags.NONE, -1, null, (connection, result) => {
            try {
                connection.call_finish(result);
            } catch (error) {
                logError(error, 'Sanket: could not switch to the session');
                SystemActions.getDefault().activateSwitchUser();
            }
        });
}

export class UserAvatar {
    constructor(menu, settings) {
        this._menu = menu;
        this._settings = settings;
        this._item = systemItem(menu._grid);
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
        this._item = null;
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
        this._cancellable = new Gio.Cancellable();
        this._usersMenu = createToggleMenu(this._item);
        this._item.notify('height');
        this._usersMenu.setHeader('system-switch-user-symbolic', _('Switch User'));
        this._usersMenu._headerIcon.add_style_class_name('sanket-switch-user-icon');
        this._usersMenu.actor.hide();
        this._usersMenu.connectObject('open-state-changed', (_menu, open) => {
            this._menu._setDimmed(open);
            this._menu._activeMenu = open ? this._usersMenu : null;
        }, owner);
        this._usersManager = new PopupMenu.PopupMenuManager(this._button);
        this._usersManager.addMenu(this._usersMenu);
        this._menu._overlay.add_child(this._usersMenu.actor);
        this._powerMenu = this._item.menu;
        this._usersMenu.actor.connectObject('notify::visible', () => {
            if (!this._usersMenu.actor.visible)
                this._item.menu = this._powerMenu;
        }, owner);
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
        this._cancellable.cancel();
        this._usersMenu.close(false);
        this._usersMenu.disconnectObject(owner);
        this._usersManager.removeMenu(this._usersMenu);
        this._usersMenu.actor.disconnectObject(owner);
        this._item.menu = this._powerMenu;
        const usersActor = this._usersMenu.actor;
        this._usersMenu.destroy();
        usersActor.destroy();
        this._button.destroy();

        this._cancellable = null;
        this._usersMenu = null;
        this._usersManager = null;
        this._powerMenu = null;
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
        const click = this._settings.get_string('user-avatar-click');
        const clickable = click === 'switch' || (click === 'users' && Boolean(this._app));
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
        if (this._settings.get_string('user-avatar-click') === 'switch' && SystemActions.getDefault().canSwitchUser) {
            this._toggleUsers();
            return;
        }
        if (!this._app)
            return;

        Main.overview.hide();
        this._menu.close();
        this._app.activate();
    }

    _toggleUsers() {
        if (this._usersMenu.isOpen) {
            this._usersMenu.close(true);
            return;
        }

        this._usersMenu.removeAll();
        otherUsers().forEach(user => this._usersMenu.addMenuItem(this._userItem(user)));
        if (!this._usersMenu.isEmpty())
            this._usersMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._usersMenu.addAction(_('Log In as Another User…'), () => {
            this._menu.close();
            SystemActions.getDefault().activateSwitchUser();
        });
        this._item.menu = this._usersMenu;
        this._usersMenu.open(true);
    }

    _userItem(user) {
        const item = new PopupMenu.PopupBaseMenuItem({style_class: 'sanket-switch-user-item'});
        const avatar = new Avatar(user, {iconSize: SWITCH_AVATAR_SIZE, styleClass: 'sanket-switch-user-avatar'});
        const label = new St.Label({text: displayName(user), x_expand: true, y_align: Clutter.ActorAlign.CENTER});

        avatar.update();
        item.add_child(avatar);
        item.add_child(label);
        item.label_actor = label;
        if (user.is_logged_in()) {
            item.add_child(new St.Label({
                style_class: 'sanket-switch-user-status',
                text: _('Signed in'),
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        item.connect('activate', () => this._switchTo(user));
        return item;
    }

    _switchTo(user) {
        const cancellable = this._cancellable;
        this._menu.close();
        Gio.DBus.system.call(...LOGIND, 'ListSessions', null, new GLib.VariantType('(a(susso))'),
            Gio.DBusCallFlags.NONE, -1, cancellable, (connection, result) => {
                if (cancellable.is_cancelled())
                    return;

                let session = null;
                try {
                    const [sessions] = connection.call_finish(result).deepUnpack();
                    const seat = GLib.getenv('XDG_SEAT') || 'seat0';
                    session = sessions.find(([, uid, , sessionSeat]) => uid === user.get_uid() && sessionSeat === seat);
                } catch (error) {
                    logError(error, 'Sanket: could not list sessions');
                }
                activateSession(session ? session[0] : null);
            });
    }
}