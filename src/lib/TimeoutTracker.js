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


import GLib from 'gi://GLib';


export class TimeoutTracker {
    constructor() {
        this._sources = new Set();
    }

    addTimeout(priority, interval, callback) {
        return this._track(handler => GLib.timeout_add(priority, interval, handler), callback);
    }

    addIdle(priority, callback) {
        return this._track(handler => GLib.idle_add(priority, handler), callback);
    }

    remove(id) {
        if (this._sources && this._sources.delete(id))
            GLib.source_remove(id);
    }

    destroy() {
        if (this._sources)
            this._sources.forEach(id => GLib.source_remove(id));
        this._sources = null;
    }

    _track(schedule, callback) {
        if (!this._sources)
            return 0;

        const id = schedule(() => {
            if (callback() === GLib.SOURCE_CONTINUE)
                return GLib.SOURCE_CONTINUE;

            if (this._sources)
                this._sources.delete(id);
            return GLib.SOURCE_REMOVE;
        });
        this._sources.add(id);
        return id;
    }
}