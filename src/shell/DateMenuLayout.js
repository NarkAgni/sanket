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


import {CalendarPanel} from '../ui/CalendarPanel.js';
import {detachActor, isActorAlive} from '../lib/Utils.js';


export class DateMenuLayout {
    constructor(dateMenu, quickSettings, settings) {
        const messageList = dateMenu._messageList;
        const area = messageList.get_parent();

        this._hiddenActors = area.get_children().filter(actor => actor !== messageList && actor.visible);
        this._hiddenActors.forEach(actor => actor.hide());

        this._panel = new CalendarPanel(dateMenu, settings);
        area.add_child(this._panel.actor);

        this._restoreIndicator = detachActor(dateMenu._indicator);
        quickSettings._indicators.insert_child_at_index(dateMenu._indicator, 0);
    }

    destroy() {
        this._panel.destroy();
        this._panel = null;

        this._hiddenActors.filter(isActorAlive).forEach(actor => actor.show());
        this._hiddenActors = null;

        this._restoreIndicator();
        this._restoreIndicator = null;
    }
}