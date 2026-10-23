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

import {WeatherCard} from './WeatherCard.js';
import {WorldClocksCard} from './WorldClocksCard.js';
import {CalendarMotion} from '../shell/CalendarMotion.js';
import {createBox, detachActor, isActorAlive} from '../lib/Utils.js';
import {HeightAnimator, MORPH_DURATION, MORPH_MODE, easeTo, fadeIn, stopFade} from './Animations.js';


const COLUMN_SPACING = 8;
const SIDE_CLASS = 'sanket-calendar-side';
const SCROLLING_CLASS = 'sanket-calendar-scrolling';

function spacing() {
    return COLUMN_SPACING * St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

const ColumnLayout = GObject.registerClass(
class ColumnLayout extends Clutter.BoxLayout {
    _init(anchor) {
        super._init({orientation: Clutter.Orientation.VERTICAL, spacing: spacing()});
        this._anchor = anchor;
    }

    vfunc_get_preferred_width(_container, forHeight) {
        return this._anchor.get_preferred_width(forHeight);
    }
});

function placeChildren(column, actors) {
    actors.forEach((actor, index) => {
        if (actor.get_parent() === column) {
            column.set_child_at_index(actor, index);
            return;
        }

        const parent = actor.get_parent();
        if (parent)
            parent.remove_child(actor);
        column.insert_child_at_index(actor, index);
    });
}

function sameChildren(column, actors) {
    const children = column.get_children();
    return children.length === actors.length && children.every((child, index) => child === actors[index]);
}

export class CalendarPanel {
    constructor(dateMenu, settings) {
        this._dateMenu = dateMenu;
        this._settings = settings;
        this._calendar = dateMenu._calendar;
        this._date = dateMenu._date;
        this._events = dateMenu._eventsItem;
        this._dateVisible = this._date.visible;
        this._side = null;
        this._main = null;
        this._wide = false;
        this._slot = null;
        this._scrolling = false;

        this._restores = [this._calendar, this._date, this._events].map(detachActor);

        this._eventsBin = new St.Bin({child: this._events, x_expand: true});
        this._clocks = new WorldClocksCard(dateMenu._clocksItem, settings);
        this._weather = new WeatherCard(dateMenu._weatherItem, settings);
        this._motion = new CalendarMotion(this._calendar);

        this.actor = createBox(false, 'sanket-calendar-panel', {y_align: Clutter.ActorAlign.START});
        this._height = new HeightAnimator(this.actor, MORPH_DURATION, MORPH_MODE);

        const sync = () => this._sync();
        this._settings.connectObject(
            'changed::calendar-layout', () => this._build(true),
            'changed::show-events', sync,
            'changed::show-date-header', sync,
            this);
        this._watched.forEach(actor => actor.connectObject('notify::visible', sync, this));
        this._dateMenu.menu.connectObject('open-state-changed', (_menu, open) => {
            if (open)
                this._weather.update();
        }, this);

        this._build(false);
    }

    get notifications() {
        return this._slot;
    }

    setNotifications(slot) {
        if (this._slot) {
            const parent = this._slot.actor.get_parent();
            if (parent)
                parent.remove_child(this._slot.actor);
            this._slot.actor.y_expand = false;
        }
        this._slot = slot;
        this._build(false);
    }

    setScrolling(scrolling) {
        this._scrolling = scrolling;
        if (!this._side)
            return;

        if (scrolling)
            this._side.add_style_class_name(SCROLLING_CLASS);
        else
            this._side.remove_style_class_name(SCROLLING_CLASS);
    }

    reflow(animate) {
        if (!this._slot)
            return;

        const shown = this._slot.actor.visible;
        if (!this._wide) {
            this._side.visible = shown;
            this._slot.setMaxHeight(this._stack(this._main.get_children(), this._calendar.get_preferred_width(-1)[1]));
            return;
        }

        this._side.visible = shown || this._cards.some(actor => actor.visible);
        const mainWidth = this._calendar.get_preferred_width(-1)[1];
        const sideWidth = this._side.get_preferred_width(-1)[1];
        const cards = this._cards.filter(actor => actor.visible);
        const main = this._stack([this._date, this._calendar], mainWidth);
        const baseline = Math.max(main, this._stack(cards, sideWidth));
        const notifications = shown ? this._slot.naturalHeight(sideWidth) : 0;
        const smallest = Math.min(this._slot.collapsedHeight() || notifications, notifications);

        const layouts = cards.map((_card, index) => index).concat(cards.length).map(moved => {
            const kept = cards.slice(0, cards.length - moved);
            const taken = cards.slice(cards.length - moved);
            const right = main + (taken.length > 0 ? spacing() + this._stack(taken, mainWidth) : 0);
            const below = kept.length > 0 ? spacing() + this._stack(kept, sideWidth) : 0;
            const height = Math.max(baseline, right, smallest + below);
            const room = height - below;
            return {moved, below, height, waste: height - right + Math.abs(room - notifications)};
        });
        const best = shown
            ? layouts.reduce((chosen, layout) => layout.waste < chosen.waste - 1 ? layout : chosen)
            : layouts[0];

        this._slot.setMaxHeight(Math.max(Math.floor(best.height - best.below), 0));
        this._arrange(cards.slice(cards.length - best.moved), animate);
    }

    destroy() {
        this._settings.disconnectObject(this);
        if (this._dateMenu.menu)
            this._dateMenu.menu.disconnectObject(this);
        this._watched.filter(isActorAlive).forEach(actor => actor.disconnectObject(this));

        this._height.stop();
        this._motion.destroy();
        stopFade(this.actor);
        if (isActorAlive(this._date))
            this._date.visible = this._dateVisible;

        [...this._restores].reverse().forEach(restore => restore());
        this._clocks.destroy();
        this._weather.destroy();
        this.actor.destroy();

        this.actor = null;
        this._height = null;
        this._side = null;
        this._main = null;
        this._wide = false;
        this._slot = null;
        this._eventsBin = null;
        this._restores = null;
        this._motion = null;
        this._weather = null;
        this._clocks = null;
        this._events = null;
        this._date = null;
        this._calendar = null;
        this._settings = null;
        this._dateMenu = null;
    }

    get _watched() {
        return [this._events, this._clocks.actor, this._weather.actor];
    }

    get _cards() {
        return [this._weather.actor, this._clocks.actor, this._eventsBin];
    }

    _stack(actors, width = -1) {
        const shown = actors.filter(actor => actor.visible);
        const heights = shown.reduce((sum, actor) => sum + actor.get_preferred_height(width)[1], 0);
        return heights + spacing() * Math.max(shown.length - 1, 0);
    }

    _arrange(moved, animate) {
        const side = [this._slot.actor, ...this._cards.filter(actor => !moved.includes(actor))];
        const main = [this._date, this._calendar, ...moved];
        if (sameChildren(this._side, side) && sameChildren(this._main, main))
            return;

        if (!animate || !this.actor.mapped) {
            placeChildren(this._side, side);
            placeChildren(this._main, main);
            return;
        }

        const fromHeight = this.actor.allocation.get_height();
        const cards = this._cards.filter(actor => actor.visible);
        const before = new Map(cards.map(actor => [actor, actor.get_transformed_position()]));

        cards.forEach(actor => {
            actor.remove_transition('translation-x');
            actor.remove_transition('translation-y');
            actor.set_translation(0, 0, 0);
        });
        placeChildren(this._side, side);
        placeChildren(this._main, main);
        this.actor.get_allocation_box();

        cards.forEach(actor => {
            const [fromX, fromY] = before.get(actor);
            const [toX, toY] = actor.get_transformed_position();
            if (Math.abs(fromX - toX) < 1 && Math.abs(fromY - toY) < 1)
                return;

            actor.set_translation(fromX - toX, fromY - toY, 0);
            easeTo(actor, {translation_x: 0, translation_y: 0}, null, MORPH_DURATION, MORPH_MODE);
        });
        this._height.animate(fromHeight);
    }

    _build(animate) {
        const wide = this._settings.get_string('calendar-layout') === 'wide';
        const slot = this._slot ? [this._slot.actor] : [];

        this._height.stop();
        [this._date, this._calendar, ...this._cards, ...slot].forEach(actor => {
            actor.remove_all_transitions();
            actor.set_translation(0, 0, 0);
            const parent = actor.get_parent();
            if (parent)
                parent.remove_child(actor);
        });
        this.actor.destroy_all_children();

        this._wide = wide;
        slot.forEach(actor => {
            actor.y_expand = true;
        });
        if (wide) {
            this._side = this._addColumn([...slot, ...this._cards]);
            this._main = this._addColumn([this._date, this._calendar]);
        } else {
            this._side = slot.length > 0 ? this._addColumn(slot) : null;
            this._main = this._addColumn([this._date, this._calendar, this._eventsBin, this._clocks.actor,
                this._weather.actor]);
        }
        if (this._side && this._slot)
            this._side.add_style_class_name(SIDE_CLASS);
        this.setScrolling(this._scrolling);

        this._sync();

        if (animate && this.actor.mapped) {
            this.actor.opacity = 0;
            fadeIn(this.actor);
        }
    }

    _addColumn(children) {
        const column = new St.Widget({
            style_class: 'sanket-calendar-column',
            layout_manager: new ColumnLayout(this._calendar),
            y_align: Clutter.ActorAlign.FILL,
        });
        children.forEach(child => column.add_child(child));
        this.actor.add_child(column);
        return column;
    }

    _sync() {
        this._date.visible = this._settings.get_boolean('show-date-header');
        this._eventsBin.visible = this._settings.get_boolean('show-events') && this._events.visible;
        if (this._side && this._wide)
            this._side.visible = this._cards.some(actor => actor.visible);
        this.reflow(this.actor.mapped);
    }
}