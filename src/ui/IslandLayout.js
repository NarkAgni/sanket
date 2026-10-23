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
        const box = current.allocation;
        x += box.x1;
        y += box.y1;
    }
    return [x, y];
}

function trimRise(rect, rise, side) {
    if (side === St.Side.TOP)
        rect.y += rise;
    if (side === St.Side.LEFT)
        rect.x += rise;
    if (side === St.Side.TOP || side === St.Side.BOTTOM)
        rect.height -= rise;
    else
        rect.width -= rise;
    return rect;
}

function insetsOf(card) {
    const cardNode = card.get_theme_node();
    const panelNode = card.get_first_child().get_theme_node();
    const inset = side => cardNode.get_margin(side) + cardNode.get_padding(side) +
        cardNode.get_border_width(side) + panelNode.get_margin(side);
    return {
        left: inset(St.Side.LEFT),
        right: inset(St.Side.RIGHT),
        top: inset(St.Side.TOP),
        bottom: inset(St.Side.BOTTOM),
    };
}

export const IslandLayout = GObject.registerClass(
class IslandLayout extends Clutter.LayoutManager {
    _init(menu) {
        super._init();
        this._menuActor = menu.actor;
        this._qsBox = menu.box;
        this._boxPointer = menu._boxPointer;
        this._source = menu.sourceActor;
    }

    get gap() {
        return CARD_GAP * scaleFactor();
    }

    opensUpward() {
        const [, sourceY] = this._source.get_transformed_position();
        const workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.findIndexForActor(this._source));
        return sourceY + this._source.height / 2 > workArea.y + workArea.height / 2;
    }

    menuRoom() {
        const monitor = Main.layoutManager.findIndexForActor(this._source);
        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor);
        return workArea.height - 2 * SCREEN_MARGIN * scaleFactor();
    }

    stackRoom() {
        const qs = this._qsRect();
        const above = this.opensUpward();
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
        if (!card)
            return;

        const inset = insetsOf(card);
        const qs = this._qsRect();
        const above = this.opensUpward();
        const gap = this.gap;
        const edge = above ? qs.screenTop : qs.screenTop + qs.height;
        const room = Math.max(this._spaceFrom(edge, above) - gap, 0) + inset.top + inset.bottom;
        const width = qs.width + inset.left + inset.right;
        const [, natural] = card.get_preferred_height(width);
        const height = Math.round(Math.min(natural, room));
        const y = above ? qs.y - gap - height + inset.bottom : qs.y + qs.height + gap - inset.top;
        const [originX, originY] = offsetIn(container, this._menuActor);

        const box = new Clutter.ActorBox();
        box.set_origin(Math.round(qs.x - inset.left - originX), Math.round(y - originY));
        box.set_size(Math.round(width), height);
        card.allocate(box);
    }

    _qsRect() {
        const rect = this._frameRect();
        const [, menuY] = this._menuActor.get_transformed_position();
        rect.screenTop = menuY + rect.y;
        return rect;
    }

    _frameRect() {
        const node = this._boxPointer.get_theme_node();
        const [hasColor, color] = node.lookup_color('-arrow-background-color', false);
        const painted = (hasColor && color.alpha > 0) || node.get_length('-arrow-border-width') > 0;
        const frame = painted ? this._boxPointer : this._qsBox;
        const [x, y] = offsetIn(frame, this._menuActor);
        const box = frame.allocation;
        const rect = {x, y, width: box.get_width(), height: box.get_height()};
        return painted ? trimRise(rect, node.get_length('-arrow-rise'), this._boxPointer._arrowSide) : rect;
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