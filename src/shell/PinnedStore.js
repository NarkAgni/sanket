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
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {SHELL_MAJOR} from '../lib/Utils.js';


const STORE_KEY = 'pinned-store';
const ENABLED_KEY = 'keep-pinned';
const MAX_ENTRIES = 50;
const FALLBACK_ICON = 'preferences-system-notifications-symbolic';

function iconToString(gicon) {
    if (!gicon || !('get_file' in gicon || 'get_names' in gicon))
        return null;
    return gicon.to_string();
}

function iconFromString(text) {
    if (!text)
        return null;

    try {
        const icon = Gio.Icon.new_for_string(text);
        return 'get_file' in icon && !icon.get_file().query_exists(null) ? null : icon;
    } catch (error) {
        logError(error, `Sanket: could not restore icon ${text}`);
        return null;
    }
}

function lookupApp(appId) {
    return appId ? Shell.AppSystem.get_default().lookup_app(appId) : null;
}

function snapshot(notification) {
    const {source} = notification;
    const app = source.app || null;
    return {
        id: GLib.uuid_string_random(),
        app: source.title || '',
        appId: app ? app.get_id() : null,
        appIcon: iconToString(source.icon),
        title: notification.title || '',
        body: notification.body || '',
        markup: Boolean(notification.useBodyMarkup),
        icon: iconToString(notification.gicon),
        time: notification.datetime.to_unix(),
    };
}

function matches(notification, entry) {
    return (notification.source.title || '') === entry.app &&
        (notification.title || '') === entry.title &&
        (notification.body || '') === entry.body &&
        notification.datetime.to_unix() === entry.time;
}

export class PinnedStore {
    constructor(settings) {
        this._settings = settings;
        this._ids = new Map();
        this._sources = new Map();
        this._spawned = new Set();
        this._entries = this._load();
    }

    get enabled() {
        return SHELL_MAJOR >= 46 && this._settings.get_boolean(ENABLED_KEY);
    }

    track(notification, pinnedAt) {
        if (!this.enabled || this._ids.has(notification))
            return;

        const entry = {...snapshot(notification), pinnedAt, rank: -1};
        this._entries.push(entry);
        this._entries.splice(0, Math.max(this._entries.length - MAX_ENTRIES, 0));
        this._ids.set(notification, entry.id);
        this._save();
    }

    refresh(notification) {
        const id = this._ids.get(notification);
        const index = this._entries.findIndex(entry => entry.id === id);
        if (index < 0)
            return;

        const {pinnedAt, rank} = this._entries[index];
        this._entries[index] = {...snapshot(notification), id, pinnedAt, rank};
        this._save();
    }

    setRanks(ranks) {
        if (!this.enabled)
            return;

        this._ids.forEach((id, notification) => {
            const entry = this._entries.find(other => other.id === id);
            if (entry)
                entry.rank = ranks.has(notification) ? ranks.get(notification) : -1;
        });
        this._save();
    }

        untrack(notification) {
        const id = this._ids.get(notification);
        this._ids.delete(notification);
        if (!id)
            return;

        this._entries = this._entries.filter(entry => entry.id !== id);
        this._save();
    }

    keep(notification) {
        const id = this._ids.get(notification);
        this._ids.delete(notification);
        const entry = this._entries.find(other => other.id === id);
        return this.enabled && entry ? this._restored(entry, this._spawn(entry)) : null;
    }

    clear() {
        this._ids.clear();
        this._entries = [];
        this._save();
    }

    restore() {
        if (!this.enabled)
            return [];

        const live = Main.messageTray.getSources().flatMap(source => source.notifications);
        return this._entries.map(entry => {
            const found = live.find(notification => !this._ids.has(notification) && matches(notification, entry));
            if (!found)
                return this._restored(entry, this._spawn(entry));

            this._ids.set(found, entry.id);
            return this._restored(entry, found);
        });
    }

    destroy() {
        this._spawned.forEach(notification => notification.disconnectObject(this));
        this._sources.forEach(source => source.disconnectObject(this));

        this._spawned = null;
        this._sources = null;
        this._ids = null;
        this._entries = null;
        this._settings = null;
    }

    _restored(entry, notification) {
        return {
            notification,
            pinnedAt: Number.isFinite(entry.pinnedAt) ? entry.pinnedAt : 0,
            rank: Number.isInteger(entry.rank) ? entry.rank : -1,
        };
    }

    _load() {
        try {
            const entries = JSON.parse(this._settings.get_string(STORE_KEY));
            return Array.isArray(entries) ? entries.filter(entry => entry && entry.id) : [];
        } catch (error) {
            logError(error, 'Sanket: pinned notification store is unreadable');
            return [];
        }
    }

    _save() {
        this._settings.set_string(STORE_KEY, JSON.stringify(this._entries));
    }

    _sourceFor(entry) {
        const key = `${entry.app}\n${entry.appId || ''}`;
        if (this._sources.has(key))
            return this._sources.get(key);

        const app = lookupApp(entry.appId);
        const icon = app ? app.get_icon() : iconFromString(entry.appIcon);
        const source = new MessageTray.Source({
            title: entry.app,
            icon: icon || Gio.ThemedIcon.new(FALLBACK_ICON),
        });
        source.connectObject('destroy', () => this._sources.delete(key), this);
        Main.messageTray.add(source);
        this._sources.set(key, source);
        return source;
    }

    _spawn(entry) {
        const source = this._sourceFor(entry);
        const notification = new MessageTray.Notification({
            source,
            title: entry.title,
            body: entry.body,
            useBodyMarkup: entry.markup,
            gicon: iconFromString(entry.icon),
            datetime: GLib.DateTime.new_from_unix_local(entry.time),
            acknowledged: true,
        });

        notification.connectObject(
            'activated', () => {
                const app = lookupApp(entry.appId);
                if (app)
                    app.activate();
            },
            'destroy', () => this._spawned.delete(notification),
            this);
        this._spawned.add(notification);
        this._ids.set(notification, entry.id);
        source.addNotification(notification);
        return notification;
    }
}