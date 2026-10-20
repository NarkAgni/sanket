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
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';


const CARD_GAP = 12;
const SCREEN_MARGIN = 24;

function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

function offsetIn(actor, ancestor) {
    let x = 0;
    let y = 0;
    for (let current = actor; current !== ancestor; current = current.get_parent()) {
        const box = current.get_allocation_box();
        x += box.x1;
        y += box.y1;
    }
    return [x, y];
}

export const IslandLayout = GObject.registerClass(
class IslandLayout extends Clutter.LayoutManager {
    _init(menu) {
        super._init();
        this._menuActor = menu.actor;
        this._qsBox = menu.box;
        this._source = menu.sourceActor;
    }

    get gap() {
        return CARD_GAP * scaleFactor();
    }

    stackRoom() {
        const qs = this._qsRect();
        const above = this._isAbove(qs);
        return this._spaceFrom(above ? qs.screenTop + qs.height : qs.screenTop, above);
    }

    vfunc_get_preferred_width() {
        return [0, 0];
    }

    vfunc_get_preferred_height() {
        return [0, 0];
    }

    vfunc_allocate(container) {
        const card = container.get_first_child();
        const qs = this._qsRect();
        const above = this._isAbove(qs);
        const gap = this.gap;
        const edge = above ? qs.screenTop : qs.screenTop + qs.height;
        const room = Math.max(this._spaceFrom(edge, above) - gap, 0);
        const [, natural] = card.get_preferred_height(qs.width);
        const height = Math.round(Math.min(natural, room));
        const y = above ? qs.y - gap - height : qs.y + qs.height + gap;
        const [originX, originY] = offsetIn(container, this._menuActor);

        const box = new Clutter.ActorBox();
        box.set_origin(Math.round(qs.x - originX), Math.round(y - originY));
        box.set_size(Math.round(qs.width), height);
        card.allocate(box);
    }

    _qsRect() {
        const [x, y] = offsetIn(this._qsBox, this._menuActor);
        const [, menuY] = this._menuActor.get_transformed_position();
        const box = this._qsBox.get_allocation_box();
        return {x, y, width: box.get_width(), height: box.get_height(), screenTop: menuY + y};
    }

    _isAbove(qs) {
        const [, sourceY] = this._source.get_transformed_position();
        return sourceY + this._source.height / 2 > qs.screenTop + qs.height / 2;
    }

    _spaceFrom(edge, above) {
        const monitor = Main.layoutManager.findIndexForActor(this._qsBox);
        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor);
        const margin = SCREEN_MARGIN * scaleFactor();
        return above
            ? edge - workArea.y - margin
            : workArea.y + workArea.height - margin - edge;
    }
});