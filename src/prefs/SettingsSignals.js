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


const handlers = new Map();

export function onSettingChanged(settings, key, callback) {
    if (!handlers.has(settings))
        handlers.set(settings, []);
    handlers.get(settings).push(settings.connect(`changed::${key}`, callback));
}

export function disconnectSettingSignals(settings) {
    const ids = handlers.get(settings) || [];
    ids.forEach(id => settings.disconnect(id));
    handlers.delete(settings);
}