// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Component, Input, Output, EventEmitter, OnInit, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { CoreTabComponent } from './tab';

/**
 * This component displays some tabs that usually share data between them.
 *
 * If your tabs don't share any data then you should probably use ion-tabs. This component doesn't use different ion-nav
 * for each tab, so it will not load pages.
 *
 * Example usage:
 *
 * <core-tabs selectedIndex="1">
 *     <core-tab [title]="'core.courses.timeline' | translate" (ionSelect)="switchTab('timeline')">
 *         <!-- Tab contents. -->
 *     </core-tab>
 * </core-tabs>
 *
 * Obviously, the tab contents will only be shown if that tab is selected.
 */
@Component({
    selector: 'core-tabs',
    templateUrl: 'tabs.html'
})
export class CoreTabsComponent implements OnInit, AfterViewInit {
    @Input() selectedIndex?: number = 0; // Index of the tab to select.
    @Output() ionChange: EventEmitter<CoreTabComponent> = new EventEmitter<CoreTabComponent>(); // Emitted when the tab changes.
    @ViewChild('originalTabs') originalTabsRef: ElementRef;

    tabs: CoreTabComponent[] = []; // List of tabs.
    selected: number; // Selected tab number.
    protected originalTabsContainer: HTMLElement; // The container of the original tabs. It will include each tab's content.

    constructor() {}

    /**
     * Component being initialized.
     */
    ngOnInit() {
        this.originalTabsContainer = this.originalTabsRef.nativeElement;
    }

    /**
     * View has been initialized.
     */
    ngAfterViewInit() {
        let selectedIndex = this.selectedIndex || 0,
            selectedTab = this.tabs[selectedIndex];

        if (!selectedTab.enabled || !selectedTab.show) {
            // The tab is not enabled or not shown. Get the first tab that is enabled.
            selectedTab = this.tabs.find((tab, index) => {
                if (tab.enabled && tab.show) {
                    selectedIndex = index;
                    return true;
                }
                return false;
            });
        }

        if (selectedTab) {
            this.selectTab(selectedIndex);
        }
    }

    /**
     * Add a new tab if it isn't already in the list of tabs.
     *
     * @param {CoreTabComponent} tab The tab to add.
     */
    addTab(tab: CoreTabComponent) : void {
        // Check if tab is already in the list.
        if (this.getIndex(tab) == -1) {
            this.tabs.push(tab);
            this.sortTabs();
        }
    }

    /**
     * Get the index of tab.
     *
     * @param  {any}    tab [description]
     * @return {number}     [description]
     */
    getIndex(tab: any) : number {
        for (let i = 0; i < this.tabs.length; i++) {
            let t = this.tabs[i];
            if (t === tab || (typeof t.id != 'undefined' && t.id === tab.id)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Get the current selected tab.
     *
     * @return {CoreTabComponent} Selected tab.
     */
    getSelected() : CoreTabComponent {
        return this.tabs[this.selected];
    }

    /**
     * Remove a tab from the list of tabs.
     *
     * @param {CoreTabComponent} tab The tab to remove.
     */
    removeTab(tab: CoreTabComponent) : void {
        const index = this.getIndex(tab);
        this.tabs.splice(index, 1);
    }

    /**
     * Select a certain tab.
     *
     * @param {number} index The index of the tab to select.
     */
    selectTab(index: number) : void {
        if (index == this.selected) {
            // Already selected.
            return;
        }

        if (index < 0 || index >= this.tabs.length) {
            // Index isn't valid, select the first one.
            index = 0;
        }

        const currenTab = this.getSelected(),
            newTab = this.tabs[index];

        if (!newTab.enabled || !newTab.show) {
            // The tab isn't enabled or shown, stop.
            return;
        }

        if (currenTab) {
            // Unselect previous selected tab.
            currenTab.element.classList.remove('selected');
        }

        this.selected = index;
        newTab.element.classList.add('selected');
        newTab.ionSelect.emit(newTab);
        this.ionChange.emit(newTab);
    }

    /**
     * Sort the tabs, keeping the same order as in the original list.
     */
    protected sortTabs() {
        if (this.originalTabsContainer) {
            let newTabs = [],
                newSelected;

            this.tabs.forEach((tab, index) => {
                let originalIndex = Array.prototype.indexOf.call(this.originalTabsContainer.children, tab.element);
                if (originalIndex != -1) {
                    newTabs[originalIndex] = tab;
                    if (this.selected == index) {
                        newSelected = originalIndex;
                    }
                }
            });

            this.tabs = newTabs;
        }
    }
}
