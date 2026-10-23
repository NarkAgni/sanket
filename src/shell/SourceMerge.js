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


import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';


const SHARED_KEY = 'sanket:';

export class SourceMerge {
    constructor() {
        this._injections = new InjectionManager();
        this._injections.overrideMethod(Main.notificationDaemon._fdoNotificationDaemon, '_getSourceForPidAndName',
            original => function (sender, pid, appName) {
                return original.call(this, sender, appName ? SHARED_KEY : pid, appName);
            });
    }

    destroy() {
        this._injections.clear();
        this._injections = null;
    }
}