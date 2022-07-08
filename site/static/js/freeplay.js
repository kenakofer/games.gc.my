/* Height of elements (z-index)
 *
 *  HIGHEST:    Action panel (invisible while I'm dragging)     z-index: 1000000000;
 *              Stuff that's dragging                                   //150000000+
 *
 *              Stuff that was just dropped in my private hand          //100000001+
 *              Stuff that was dropped earlier in my private hand
 *              ------- Floor of the private hand --------                100000000
 *
 *              Stuff that was just dropped on the main content
 *              Stuff that was dropped earlier on the main content
 *              ------- Floor of the main content --------
 *
 */
// Any varibles preceded by "template_" are inserted into the html's inline js
"use strict";
var draggable_settings;
var droppable_settings;
var clickable_settings;
var get_apm_obj;
var apm;
var send_message = function () {};
var tooltips;

var nocolor = function (qm) {
    if (qm.startsWith("$*"))
        return qm.substring(3);
    return qm;
};
var get_color_class = function (qm) {
    if (qm.startsWith("$*"))
        return 'player-color-'+qm.substring(2, 3);
    return "";
};

$( document ).ready(function () {
    // For IE, which doesn't have includes
    if (!String.prototype.includes) {
      String.prototype.includes = function (search, start) {
        if (typeof start !== 'number') {
          start = 0;
        }

        if (start + search.length > this.length) {
          return false;
        } else {
          return this.indexOf(search, start) !== -1;
        }
      };
    }

    /* Allow simulating hover events on mobile */
    $('.Card').on('touchstart touchend', function(e) {
        e.preventDefault();
        $(this).toggleClass('hover_effect');
    });

    // Keeps undesired operations away
    function deepFreeze(obj) {

        // Retrieve the property names defined on obj
        var propNames = Object.getOwnPropertyNames(obj);

        // Freeze properties before freezing self
        propNames.forEach(function (name) {
            var prop = obj[name];

            // Freeze prop if it is an object
            if (typeof prop == 'object' && prop !== null)
                deepFreeze(prop);
        });
        //Freeze self (no-op if already frozen)
        return Object.freeze(obj);
    }
    var entityMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;',
      '`': '&#x60;',
      '=': '&#x3D;'
    };

    function escapeHtml (string) {
      return String(string).replace(/[&<>"'`=\/]/g, function (s) {
        return entityMap[s];
      });
    }

    function TableMovable(id, position, dimensions, dependent_ids, parent_id, display_name) {
        var self = this;
        self.id = id;                       // The id of the apm element and html element
        self.position = position;           // The [x,y] position of the apm object to be synced with the html position
        self.dimensions = dimensions;       // The [w,h] dimensions of the apm object to be synced with the html dimensions
        self.dependent_ids = dependent_ids; // A list of the ids of dependent objects. This currently only means cards or dice that are in a deck
        self.set_parent_id(parent_id);      // The children cards and dice also store a reference to their parent
        self.player_moving_index = -1;      // The index of the player moving this object
        self.display_name = display_name;   // The name to display. Currently only decks display the display name
        self.depth = 0;                     // The z-index of the apm object, to be synced with the html elem
        self.type = "";                     // One of "Deck", "Card", "Dice"
        self.privacy = -1;                  // Index of player it is privately visible to (in the private hand of), -1 for public
        self.images = [                     // Most cards will have a front and back side. Dice might have 6, 8, etc.
            {},
            {url: '/static/images/freeplay/red_back.png', style: "100% 100%"}
        ];
        self.show_face_number = -1;            // Which image is currently being displayed. Cards will have two images: front (index 0) and back (index 1). Dice will have more
        self.stack_group = "";              // Cards and dice in the same stack group can be put into a deck with each other
        self.dfuo = [];                     // Default face up per card offset. [public, private]
        self.dfdo = [];                     //              down
        self.html_elem = false;             // Store the jquery selector for this object
        self.tooltip_elem = false;          // Store the jquery selector for this object's tooltip
        self.image_elem = false;            // Store the jquery selector for this object's image
        self.rotation = 0;                  // int from 0 to 360 CW
        self.can_rotate = false;            // Whether or not the rotation buttons will be shown

        self.drop_time = 0;
        self.has_synced_once = false;
    }
    TableMovable.prototype.update_full_display_name = function () {
        if (this.type === 'Deck') {
            var text = this.display_name;
            var l = this.dependent_ids.length;
            var opd = this.offset_per_dependent();
            var easily_counted = opd && (opd[0] > 12 || opd[1] > 12) && l <= 5
            if (l > 1 && !easily_counted)
                text = "("+l+") "+text;
            var span = $( 'span.display-name', this.html_elem );
            // Update the html
            span.html(text);
        } else {
            // Put the display name as the hover text with title
            var span = this.tooltip_elem;
            if (this.show_face_number == 0 || this.type === 'NumberCard') {
                // Update the html
                span.html(this.display_name);
                //this.html_elem.attr('title', this.display_name);
            } else {
                span.empty();
            }
        }
    };
    TableMovable.prototype.refresh_html_elem = function () {
        if (! this.html_elem || this.html_elem.closest('body').length == 0)
            if ([-1, template_player_index].includes(this.privacy) && $( '#'+this.id).length ) {
                this.html_elem = $( '#'+this.id );
                console.log('switching the html elem');
            }
    };
    TableMovable.prototype.dimension_offset = function () {
        if (this.type == 'Deck') {
            return [15, 36];
        }
        // Otherwise
        return [0, 0];
    };

    TableMovable.prototype.start_roll = function (number_left, final_val) {
        if (number_left <= 0) {
            this.show_face_number = final_val;
            this.sync_image();
            return
        }
        this.html_elem.toggleClass('rotate');
        this.show_face_number = Math.floor(Math.random() * this.images.length);
        this.sync_image();
        var obj = this;
        setTimeout(function (){
            obj.start_roll(number_left-1, final_val);
        }, 50);
    }
    TableMovable.prototype.sync_rotation = function () {
        this.image_elem.removeClass('rotate').removeClass('rotate0').removeClass('rotate1').removeClass('rotate2').removeClass('rotate3');
        this.rotation = this.rotation % 360;
        this.image_elem.css({
            'transform-origin': 'initial',
            '-webkit-transform': 'rotate('+this.rotation+'deg)',
            '-moz-transform': 'rotate('+this.rotation+'deg)',
            '-ms-transform': 'rotate('+this.rotation+'deg)',
            '-o-transform': 'rotate('+this.rotation+'deg)',
        });
    }
    TableMovable.prototype.offset_per_dependent = function () {
        if (this.dependent_ids.length === 0) {
            return;
        }
        var first_dep = get_apm_obj(this.dependent_ids[0]);
        if (! first_dep) {
            return;
        }
        var result;
        if (first_dep.show_face_number === 0 || first_dep.type === "Dice" || first_dep.type === "NumberCard") {
            result = first_dep.dfuo;
        } else {
            result = first_dep.dfdo;
        }
        if (!(result instanceof Array)) {
            // Result is actually a dict
            if (first_dep.privacy === -1)
                result = result['public'];
            else
                result = result['private'];
        }
        return result;
    };

    TableMovable.prototype.get_index_in_parent = function () {
        var p = get_apm_obj(this.parent_id);
        if (! p)
            return 0;
        var i = p.dependent_ids.indexOf( this.id );
        return Math.max(0, i);
    };

    TableMovable.prototype.position_offset = function () {
        if (this.type == 'Deck') {
            return [-10, -27];
        } else if (['Card', 'Dice', 'NumberCard'].includes(this.type) && this.parent_id) {
            var i = this.get_index_in_parent();
            var p = get_apm_obj(this.parent_id);
            var opd = p.offset_per_dependent() || [0.5, 0.5];
            return [i * opd[0], i * opd[1]];
        }
        // Otherwise
        return [0, 0];
    };

    TableMovable.prototype.get_stack_group = function () {
        if (this.stack_group) {
            return this.stack_group
        } else if (this.dependent_ids.length) {
            return get_apm_obj(this.dependent_ids[0]).stack_group;
        }
        return false;
    }
    TableMovable.prototype.sync_position = function (time) {
        if (time === undefined) {
            time = 200;
        }
        // The first syncing when the user loads the page should be instant
        if (this.has_synced_once === false) {
            this.has_synced_once = true;
            time = 0;
        }
        // If the html_elem doesn't exist or is outdated (like from a private/public switch)
        if (! this.html_elem || this.html_elem.closest('body').length == 0) {
            this.html_elem = $('#'+this.id);
            console.log('refreshing html elem');
        }
        // Make the dimensions of a containing parent big enough to encompass its deps
        var width = this.dimensions[0];
        var height = this.dimensions[1];
        if (this.type == "Deck" && this.dependent_ids.length) {
            var maxw = width; var maxh = height;
            this.dependent_ids.forEach(function (dep_id) {
                var apm_dep = get_apm_obj(dep_id);
                if (apm_dep) {
                    maxw = Math.max(maxw, apm_dep.position_offset()[0] + apm_dep.dimensions[0]);
                    maxh = Math.max(maxh, apm_dep.position_offset()[1] + apm_dep.dimensions[1]);
                }
            });
            width = maxw;
            height = maxh;
        }
        width += this.dimension_offset()[0];
        height += this.dimension_offset()[1];

        // make the contained image div the correct width and height before the posible rotational switch
        if (this.type == 'Card') {
            this.image_elem.css({'width': width, 'height': height});
        }

        this.html_elem.css({
            "z-index": this.depth
        });
        var css_obj = {
            "left":this.position[0]+this.position_offset()[0],
            "top": this.position[1]+this.position_offset()[1],
            "width": width,
            "height": height
        };
        var current_position = this.html_elem.position();
        // A ballpark estimate of the changes to the card position and dimensions
        var distance_to_move =
            Math.abs(css_obj['left'] - current_position.left) +
            Math.abs(css_obj['top'] - current_position.top) +
            Math.abs(css_obj['height'] - this.html_elem.height());
        if (time <= 0 || distance_to_move < 5) {
            // This is significantly faster than even a 0ms animation,
            // so we'll use it if the changes are minor enough
            this.html_elem.stop(true, false).css(css_obj);
        } else {
            this.html_elem.stop(true, false).animate( css_obj, {duration:time, queue:false} );
        }
        // Make the height of the content window big enough to scroll down and see it
        // Was having an issue with html_elem.position(...) is undefined, so check that
        if (! currently_dragging && this.html_elem.position()) {
            var min_height = this.html_elem.position().top + this.html_elem.height() + private_hand.height() - 50;
            if ( content.height() < min_height) {
                content.height(min_height);
            }
        }
    };

    TableMovable.prototype.sync_image = function () {
        if (this.type === "Deck")
            return
        if (this.type === "NumberCard") {
            // NumberCards just show their number rather than an image
            var span = $('span.display-content', this.html_elem);
            span.html(this.show_face_number);
            return;
        }
        if (this.show_face_number < 0) {
            console.error('Card image is less than 0');
            return;
        }
        if (! this.images[this.show_face_number]) {
            console.error('Card has no image '+this.show_face_number);
            return;
        }
        var image = this.images[this.show_face_number];
        this.image_elem.css({
            'background-image': "url("+image['url']+")",
            'background-size': image['style']
        });
    };
    TableMovable.prototype.change_privacy = function (privacy_index) {
        if (privacy_index === this.privacy)
            return;
        this.privacy = privacy_index;
        var new_container;
        this.html_elem.detach();
        if (privacy_index == -1) {
            new_container = public_movables;
        } else if (privacy_index == template_player_index) {
            new_container = my_private_movables;
        } else {
            new_container = hidden_movables;
        }
        if (new_container) {
            this.html_elem = this.html_elem.appendTo(new_container);
        }

        // If it is changing to a state visible to this user, it will need to have its position updated quick
        if ( [-1, template_player_index].includes(this.privacy) ) {
            this.sync_position(0);
        }
    };
    TableMovable.prototype.emit_continue_move = function(prior_position) {
        // Only continue the loop if this player is moving the card
        if (this.player_moving_index === template_player_index) {
            // Only send the update if the positon is new
            if (!prior_position || this.position[0] !== prior_position[0] || this.position[1] !== prior_position[1]) {
                socket.emit('CONTINUE MOVE', {gameid:template_gameid, obj_id:this.id, position:this.position});
            }
            // Call this function again in a bit
            var _this = this
            prior_position = this.position;
            setTimeout(function (){
                _this.emit_continue_move(prior_position)
            }, 200);
        }
    }

    var private_hand_vertical_offset = function () {
        return content.offset().top - private_hand.offset().top + 2;
    };
    var private_hand_horizontal_offset = function () {
        return content.offset().left - private_hand.offset().left + 2;
    };

    var sync_action_buttons = function (should_hide) {
        // If the option buttons are attached to this object, move it too.
        var html_obj = $( '#'+apm.show_action_buttons_for_id);
        var html_image = $('.image', html_obj);
        var apm_obj = get_apm_obj(apm.show_action_buttons_for_id);
        var html_pos = html_obj.position();

        // Hide all tooltips (to possibly enable one later on)
        if (tooltips) {
            tooltips.css({"visibility":"hidden"});
        } else {
            // The cards haven't loaded yet. We should get out.
            return;
        }


        if (!should_hide && html_pos) {
            var position_type = 'absolute';
            if (apm_obj.privacy !== -1) {
                position_type = 'fixed';
                // Since it's private, get the position relative to the screen
                html_pos = html_obj.offset();
                html_pos.top -= jwindow.scrollTop();
                html_pos.left -= jwindow.scrollLeft();
            }

            //Detach all the buttons
            deal_spinner_parent.detach();
            deal_button.detach();
            action_button_br.detach();
            shuffle_button.detach();
            roll_button.detach();
            up_button.detach();
            down_button.detach();
            flip_button.detach();
            sort_button.detach();
            right_button.detach();
            left_button.detach();

            var obj_height = Math.max(html_obj.height(), html_image.height());
            var obj_width = Math.max(html_obj.width(), html_image.width());

            // Put in specific buttons
            if (apm_obj.type == "Deck") {
                // If it's a deck of cards, put shuffle/flip/sort button, if it's dice put roll button
                var first_dep = get_apm_obj(apm_obj.dependent_ids[0]);
                if (first_dep) {
                    if (first_dep.type === 'Dice') {
                        action_button_panel.append(roll_button);
                    } else {
                        action_button_panel.prepend(action_button_br);
                        action_button_panel.prepend(deal_button);
                        action_button_panel.prepend(deal_spinner_parent);
                        action_button_panel.append(flip_button);
                        action_button_panel.append(shuffle_button);
                        action_button_panel.append(sort_button);
                        action_button_panel.append(sort_button);
                    }
                }

            } else if (apm_obj.type == "Card") {
                action_button_panel.append(flip_button);
                if (apm_obj.can_rotate) {
                    action_button_panel.prepend(right_button);
                    action_button_panel.append(left_button);
                }
            } else if (apm_obj.type == "Dice") {
                action_button_panel.prepend(action_button_br);
                action_button_panel.prepend(up_button);
                action_button_panel.prepend(roll_button);
                action_button_panel.append(down_button);
            } else if (apm_obj.type == "NumberCard") {
                action_button_panel.append(up_button);
                action_button_panel.append(down_button);
            }
            // Set visible tooltips
            if (apm_obj.type != "Deck") {
                if (apm_obj.display_name && (apm_obj.type != "Card" || apm_obj.show_face_number === 0)) {
                    // Move the tooltip to centered just below the card
                    apm_obj.tooltip_elem.css({
                        'visibility':'visible',
                        'left':html_pos.left + obj_width/2 - apm_obj.tooltip_elem.width()/2,
                        'top': html_pos.top  + obj_height + 10,
                        'position': position_type
                    });
                }
            }


            var panel_height = action_button_panel.height();
            var panel_width = action_button_panel.width();

            // For deck, place the action buttons above
            action_button_panel.css({
                "left":html_pos.left + obj_width/2 - panel_width/2,
                "top": html_pos.top - panel_height - 2,
                "display": "inline",
                "position": position_type
            });
        } else {
            action_button_panel.css({
                "display": "none"
            });
        }

    };

    // Careful, it places this on top of the pid stack
    TableMovable.prototype.set_parent_id = function (pid) {
        if (this.parent_id === pid)
            return;
        // Remove from old parent dependents if possible
        var obj_old_parent = get_apm_obj( this.parent_id );
        if (obj_old_parent) {
            var array = obj_old_parent.dependent_ids;
            var index = $.inArray(this.id, array);
            if (index >= 0)
                array.splice( index, 1);
            obj_old_parent.update_full_display_name();
            obj_old_parent.sync_position(); //To update dimensions 
            // This doesn't look good if we don't also sync position on siblings
            // Only sync siblings that have a higher index in parent, since they are the only ones that will shift
            for (var i = index; i < obj_old_parent.dependent_ids.length; i++) {
                var d_id = obj_old_parent.dependent_ids[i];
                var apm_dep = get_apm_obj(d_id);
                if (apm_dep)
                    apm_dep.sync_position();
            }
        }
        // Set new parent
        this.parent_id = pid;
        if (pid === false || pid === undefined) {
            // Don't need to do anything
        } else {
            // Try to find the new parent
            var obj_parent = get_apm_obj(pid);
            // If the parent doesn't exist yet, make it
            if (! obj_parent) {
                obj_parent = createBasicTableMovable(pid);
            }
            // Add this to its dependents
            if (! obj_parent.dependent_ids.includes(this.id) )
                obj_parent.dependent_ids.push(this.id);
        }
        this.set_droppability();
    };

    /* If the object has no parent, give it droppability. Otherwise take it away.
     */
    TableMovable.prototype.set_droppability = function () {
        // If the html_elem doesn't exist or is outdated (like from a private/public switch)
        if (! this.html_elem || this.html_elem.closest('body').length == 0) {
            return;
            //this.html_elem = $('#'+this.id);
        }
        if ( this.parent_id === false || this.parent_id === undefined ) {
            this.html_elem.droppable(droppable_settings);
        } else {
            try {
                this.html_elem.droppable("destroy");
            } catch (err) {}
        }
    };

    function AppViewModel() {
        var self = this;
        self.players = [];
        self.quick_messages = ["I win!", "Good game", "Your turn"];
        self.messages = {}
        //self.movables = {};
        self.show_action_buttons_for_id = false;
        self.public_movables = {};
        self.have_received_update = false;
        self.private_card_count = function (player_index) {
            var filtered = Object.keys(self.public_movables).reduce(function (filtered, key) {
                    if (self.public_movables[key].type !== 'Deck' && self.public_movables[key].privacy == player_index)
                        filtered[key] = self.public_movables[key];
                    return filtered;
            }, {});
            return Object.keys(filtered).length;
        };
        self.set_private_hand_label_text = function () {
            var text = "Your private hand";
            var num_cards = self.private_card_count(template_player_index);
            if (num_cards > 0)
                text += " ("+num_cards+")";
            var elem = $('#private-label');
            elem.html(text);
            return text;
        };
        self.set_other_players_info_text = function () {
            var text = "";
            var no_one = true;
            for (var i=0; i<self.players.length; i++) {
                if (i == template_player_index)
                    continue;
                no_one = false;
                text += ", "; // We remove the first of these after
                text += '<span class="player-color-'+(i%6)+'">';
                text += self.players[i];
                var num_cards = self.private_card_count(i);
                text += '</span>';
                if (num_cards > 0)
                    text += " ("+num_cards+")";
            }
            text = text.substring(2); // Remove first ", "
            text = "Other players: "+text;
            if (no_one)
                text = "No one else has joined your game yet. Have you given them your url?";
            var elem = $('#other-players-info');
            elem.html(text);
            return text;
        };
    }

    apm = new AppViewModel();
    var time_of_drag_emit = 0;
    var currently_dragging = false;
    var time_of_drop_emit = 0;

    var dragging_z = 150000000;
    var get_dragging_depth = function () {
        dragging_z += 1;
        return dragging_z;
    };

    var dropped_public_z = 50000001;
    var get_dropped_public_depth = function () {
        dropped_public_z += 1;
        return dropped_public_z;
    };
    var dropped_private_z = 500000001;
    var get_dropped_private_depth = function () {
        dropped_private_z += 1;
        return dropped_private_z;
    };

    function createBasicTableMovable(id) {
        var apm_obj = new TableMovable(id, [0, 0], [0, 0], [], false, undefined);
        // Add it to the public list
        apm.public_movables[id] = apm_obj;
        // Add it to the html
        public_movables.append('<div id="'+id+'" class="table-movable droppable noselect ui-widget-content"><span class="display-name"></span><span class="display-content"></span><div class="image"></div></div>');
        tooltip_panel.append('<span id="'+id+'-tooltip" class="display-name tooltiptext"></span>');
        // Give it its html_elem and tooltip and image_elem
        apm_obj.html_elem = $( '#'+apm_obj.id );
        apm_obj.image_elem = $('.image', apm_obj.html_elem);
        apm_obj.tooltip_elem = $( '#'+apm_obj.id+'-tooltip' );
        apm_obj.tooltip_elem.on('click', function(){ $(this).css({'visibility':'hidden'}); });
        // Update the global tooltip selector
        tooltips = $('.tooltiptext');
        // Make it draggable and droppable
        apm_obj.html_elem.draggable(draggable_settings);
        apm_obj.html_elem.droppable(droppable_settings);
        apm_obj.html_elem.click(clickable_settings);
        apm_obj.set_droppability();

        return apm_obj;
    }

    clickable_settings =  function () {
        // If we clicked on the same one again, hide the button
        var target_id = this.id;
        var apm_obj = get_apm_obj(this.id);
        if (apm_obj && apm_obj.dependent_ids && apm_obj.dependent_ids.length === 1) {
            target_id = apm_obj.dependent_ids[0];
        }
        if (apm.show_action_buttons_for_id === target_id) {
            apm.show_action_buttons_for_id = false;
            sync_action_buttons();
        }
        else {
            apm.show_action_buttons_for_id = target_id;
            sync_action_buttons();
        }
    };

    draggable_settings = {
            start: function (elem, ui) {
                var html_elem = $('#'+elem.target.id);
                var apm_obj = get_apm_obj(elem.target.id);
                socket.emit('START MOVE', {gameid:template_gameid, obj_id:elem.target.id});
                html_elem.css({'z-index':get_dragging_depth()});
                currently_dragging = apm_obj;
                // Start all of the dependents dragging as well
                apm_obj.dependent_ids.forEach(function (d_id) {
                    var apm_dep = get_apm_obj(d_id);
                    if (apm_dep) {
                        apm_dep.depth = get_dragging_depth();
                        apm_dep.sync_position(0);
                    }
                });
                // Remove this object from its parents
                if (apm_obj.parent_id) {
                    apm_obj.set_parent_id(false);

                }
                // Hide action buttons for duration of drag
                sync_action_buttons(true);
                // If the action buttons are on another element, switch them to this element
                var follow_id = apm.show_action_buttons_for_id;
                if (follow_id && follow_id !== apm_obj.id) {
                    apm.show_action_buttons_for_id = apm_obj.id;
                }
                // Set the current player moving
                apm_obj.player_moving_index = template_player_index;
                // Start the looping of emit_continue_move
                apm_obj.emit_continue_move();
            },
            drag: function (elem, ui) {
                var html_elem = $('#'+elem.target.id);
                var apm_obj = get_apm_obj(elem.target.id);
                // Snap to the grid if specified
                var pos = get_position_array_from_html_pos(html_elem.position());
                pos[0] -= apm_obj.position_offset()[0];
                pos[1] -= apm_obj.position_offset()[1];
                apm_obj.position = pos;
                // Move all the dependents as well
                apm_obj.dependent_ids.forEach(function (d_id) {
                    var apm_dep = get_apm_obj(d_id);
                    if (apm_dep){
                        apm_dep.position = pos;
                        apm_dep.sync_position(0);
                    }
                });
            },
            stop: function (elem, ui) {
                var apm_obj = get_apm_obj(elem.target.id);
                currently_dragging = false;
                var now = new Date().getTime();
                if (now - apm_obj.drop_time > 200) {
                    var html_elem = $('#'+elem.target.id);
                    var pos = get_position_array_from_html_pos(html_elem.position());
                    pos[0] -= apm_obj.position_offset()[0];
                    pos[1] -= apm_obj.position_offset()[1];
                    apm_obj.depth = get_dropped_public_depth();
                    apm_obj.position = pos;
                    apm_obj.sync_position(0);
                    // Move all the dependents as well
                    apm_obj.dependent_ids.forEach(function (d_id) {
                        var apm_dep = get_apm_obj(d_id);
                        if (apm_dep) {
                            apm_dep.depth = get_dropped_public_depth();
                            apm_dep.position = pos;
                            apm_dep.sync_position(0);
                        }
                    });
                    // If the object was private, we need to do a position offset
                    if (apm_obj.privacy !== -1) {
                        pos[0] -= private_hand_horizontal_offset();
                        pos[1] -= private_hand_vertical_offset();
                    }
                    if (apm_obj.snap_card_to_grid) {
                        pos[0] = Math.round(
                                    (pos[0] - apm_obj.snap_card_to_grid[0][1]) / apm_obj.snap_card_to_grid[0][0]
                                ) * apm_obj.snap_card_to_grid[0][0] + apm_obj.snap_card_to_grid[0][1];
                        pos[1] = Math.round(
                                    (pos[1] - apm_obj.snap_card_to_grid[1][1]) / apm_obj.snap_card_to_grid[1][0]
                                ) * apm_obj.snap_card_to_grid[1][0] + apm_obj.snap_card_to_grid[1][1];
                        ui.position.left = pos[0];
                        ui.position.top = pos[1];
                        console.log(pos);
                    }
                    // Set the current player moving to none
                    apm_obj.player_moving_index = -1;
                    // Move the action buttons
                    sync_action_buttons(); //This really should wait until the object has synced position
                    // Tell the server about the stop move
                    socket.emit('STOP MOVE', {
                        gameid:template_gameid,
                        obj_id:elem.target.id,
                        position:pos,
                        privacy: -1 //If this stop is being called rather than the other, must be public
                    });
                }
            },
        };
   droppable_settings ={
        classes: {
            "ui-droppable-active": "ui-state-active",
            "ui-droppable-hover": "ui-state-hover"
        },
        accept: function (el) {
            return el.hasClass('Card') || el.hasClass('Deck') || el.hasClass("Dice") || el.hasClass("NumberCard");
        },
        drop: function ( event, ui ) {
            var now = new Date().getTime();
            var top_id = ui.draggable.context.id;
            var apm_top = get_apm_obj(top_id);
            var top_html = apm_top.html_elem;
            var top_middle_y = top_html.offset().top + top_html.height()/2;
            var bottom_id = event.target.id;
            var apm_bottom = get_apm_obj(bottom_id);
            var top_group = apm_top.get_stack_group();
            var bottom_group = apm_bottom.get_stack_group();
            if (top_group && bottom_group && top_group != bottom_group) {
                console.log('elems are in different stack groups, so ignoring drop');
                return;
            }
            if (apm_bottom.privacy === -1 && top_middle_y > private_hand.offset().top) {
                console.log('elem is below private hand line, won\'t trigger public drop');
                return;
            }
            if (apm_top.dependent_ids.includes(bottom_id)) {
                console.log('You cannot drop '+top_id+' onto one of its dependents');
                return;
            }
            if (now - time_of_drop_emit < 200) {
                console.log('too soon since last drop event');
                return;
            }
            console.log("Dropping "+top_id+' on '+bottom_id);
            time_of_drop_emit = now;
            // Line up the dropped object
            // If either is not a deck or card, ignore the drop
            if (!['Deck', 'Card', 'Dice', 'NumberCard'].includes(apm_top.type) || !['Deck', 'Card', 'Dice', 'NumberCard'].includes(apm_bottom.type))
                return;
            // We want to prevent emitting the stop event after this
            apm_top.drop_time = now;
            apm_top.depth = get_dragging_depth();
            apm_top.dependent_ids.forEach(function (d_id) {
                var apm_dep = get_apm_obj(d_id);
                if (! apm_dep)
                    return;
                apm_dep.depth = get_dragging_depth();
                apm_dep.sync_position(0);
            });
            apm_top.sync_position(0);
            // Prevent more calls to emit_continue_moe
            apm_top.player_moving_index = -1;
            // Move the action buttons
            sync_action_buttons();
            // Tell the server to combine the two
            socket.emit('COMBINE', {gameid:template_gameid, top_id:top_id, bottom_id:bottom_id});
        }
    };

    get_apm_obj = function (oid) {
        if (oid in apm.public_movables)
            return apm.public_movables[oid];
    };

    // Socketio functions
    socket.on('SHOULD REQUEST UPDATE', function (data) {
       request_update();
    });

    var request_update = function () {
        socket.emit('UPDATE REQUEST', {gameid:template_gameid});
    };
    var join_room = function() {
        console.log('Attempting to join room '+template_gameid);
        if (! apm.have_received_update) {
            socket.emit('JOIN ROOM', {room:template_gameid});
            setTimeout(join_room, 1000);
        } else {
            console.log('Joined room.');
            if (window.location.search.includes("runtests")) {
                QUnit.start();
            }
        }
    }
    join_room();

    socket.on('UPDATE', function (d) {
        const data = d;
        deepFreeze(data);
        apm.have_received_update = true;
        if (data.players) {
            apm.players = data.players.slice();
        }
        // quick_messages update
        if (data.quick_messages) {
            var qms = [];
            for (var i=0; i<apm.players.length; i++) {
                var name = template_player_index === i ? 'Me' : apm.players[i];
                qms.push('$*'+i+'@'+name);
            }
            qms = qms.concat(data.quick_messages);
            apm.quick_messages = qms;
            var elem = $('#quick-messages');
            elem.empty();
            qms.forEach(function(message) {
                elem.append('<button class="quick-message-button '+get_color_class(message)+'" data-message="'+message+'">'+nocolor(message)+'</button>');
            });
            var buttons = $('.quick-message-button', elem);
            buttons.on('click', function() {
                send_message($(this).data('message'));
            });
        }
        // Instructions update
        if (data.instructions_html) {
            instructions_tab.html(data.instructions_html);
        }
        //Messages update
        if (data.messages) {
            $('.loader').remove();
            var messages = data.messages.slice()
            // If we already have some messages client side, don't display the first one sent
            // from the server. Use it instead to see if we need to print message headers on
            // the subsequent one
            var last_time = -1;
            var last_player_index = -10;
            if (! jQuery.isEmptyObject(apm.messages)) {
                var start_message = messages.shift();
                if (start_message) {
                    last_time = start_message.timestamp;
                    last_player_index = start_message.player_index;
                }
            }
            var html_string = "";
            messages.forEach(function (m) {
                var id = m.id;
                apm.messages[id] = m;
                $('#'+id, message_box).remove();
                html_string += '<div id="'+id+'">';
                if (m.timestamp - last_time > 15 || last_player_index != m.player_index) {
                    var date = new Date(m.timestamp*1000);
                    var hours = date.getHours();
                    var minutes = date.getMinutes();
                    var seconds = date.getSeconds();
                    if(minutes<10)
                      minutes= ""+0+minutes;
                    else
                      minutes = minutes;
                    if(seconds<10)
                      seconds = ""+0+seconds;
                    else
                      seconds = seconds;
                    html_string += '<span class="message-time">'+hours+':'+minutes+':'+seconds+'</span> ';
                    var i = m.player_index;
                    var player_name = m.player_index >= 0 ? apm.players[m.player_index] : 'Server';
                    html_string += '<span class="message-name player-color-'+((i+6)%6)+'">'+player_name+':</span><br>';
                }
                last_time = m.timestamp;
                last_player_index = m.player_index;
                var text = m.text;
                // Escape the html to keep everyone safe from nasties ;)
                text = escapeHtml(m.text);
                // decode utf8 stuff so emojis and stuff are right (this has to come after)
                text = decodeURIComponent(escape(text));
                var span_classes = m.player_index === -1 ? "" : "message-text "
                // If there is a color prefix, add that class
                var words = text.split(' ');
                for (var i in words) {
                    if (words[i].startsWith("$*")) {
                        var class_string = 'player-color-'+(words[i].substring(2, 3) % 6);
                        words[i] = '</span><span class="'+span_classes+class_string+'">'+words[i].substring(3)+'</span><span class="'+span_classes+'">';
                    }
                }
                text = words.join(' ');
                text = '<span class="'+span_classes+'">'+text+'</span>'
                html_string += text;
                html_string += '</div>';
            });
            message_box.append(html_string);
            // Scroll to the bottom:
            message_box.stop(true, false).animate({scrollTop:message_box[0].scrollHeight}, {duration:300, queue:false});
            // Remove the bar on sending more messages
            message_waiting_to_send = false;

        }
        //Set private hand height
        if (! [undefined, null].includes(data.private_hand_height)) {
            set_private_hand_once(data.private_hand_height, parseInt(private_hand.css('bottom'), 10));
        }
        //Movables changes
        if (! data.movables_info)
            return;
        data.movables_info.forEach(function (obj_data) {
            var apm_obj = get_apm_obj(obj_data.id);
            if (apm_obj === currently_dragging)
                return;
            var position_sync_time = 300;
            var should_sync_position = false;
            if (!apm_obj) {
                //Create the obj if it doesn't exist yet.
                apm_obj = createBasicTableMovable(obj_data.id);
                position_sync_time = 0;
                should_sync_position = true;
            }
            apm_obj.refresh_html_elem();

            //Update its info
            if ('dependents' in obj_data) {
                obj_data.dependents.forEach(function (did) {
                    var dep_obj = get_apm_obj(did);
                    if (dep_obj)
                        dep_obj.set_parent_id(apm_obj.id);
                });
                // Make sure the order is right:
                apm_obj.dependent_ids = obj_data.dependents.slice();
            }
            if ('destroy' in obj_data && obj_data.destroy == true) {
                console.log('destroying '+apm_obj.id);
                // Make all the dependents orphans
                // As it is, destroying a parent destroys the child too, so this is unnecessary
                // ^^^ Wrong. In the case of destroying the deck with a single descendent.
                apm_obj.dependent_ids.forEach(function (did) {
                    var dep_obj = get_apm_obj(did);
                    if (dep_obj)
                        dep_obj.set_parent_id(false);
                });
                // Make the parent lose the child
                apm_obj.set_parent_id(false);
                // If the action buttons were attached to it, detach them
                if (apm.show_action_buttons_for_id == apm_obj.id) {
                    apm.show_action_buttons_for_id = false;
                    sync_action_buttons();
                }
                // Remove from html
                apm_obj.html_elem.remove();
                apm_obj.tooltip_elem.remove();
                // Prevent more calls to emit_continue_moe
                apm_obj.player_moving_index = -1;
                // Remove from the movables array
                delete apm.public_movables[obj_data.id];
                return;
            }
            if ('parent' in obj_data){
                apm_obj.set_parent_id(obj_data.parent);
            }
            if ('stack_group' in obj_data)
                apm_obj.stack_group = obj_data.stack_group;
            if ('player_moving_index' in obj_data) {
                apm_obj.player_moving_index = obj_data.player_moving_index;
                // Remove player-moving classes
                apm_obj.html_elem.removeClass (function (index, className) {
                        return (className.match (/(^|\s)player-moving\S+/g) || []).join(' ');
                });
                // Add the relevant one
                apm_obj.html_elem.addClass('player-moving'+apm_obj.player_moving_index%6);
            }
            if ('privacy' in obj_data) {
                if (obj_data.privacy != apm_obj.privacy)
                    position_sync_time = 0;
                apm_obj.change_privacy(obj_data.privacy)
                apm_obj.dependent_ids.forEach(function (did) {
                    var dep_obj = get_apm_obj(did);
                    if (dep_obj) {
                        dep_obj.change_privacy(obj_data.privacy);
                        dep_obj.sync_image();
                    }
                });
                // The html_elem has changed
                apm_obj.refresh_html_elem();
            }
            if ('type' in obj_data) {
                apm_obj.type = obj_data.type;
                apm_obj.html_elem.addClass(obj_data.type);
            }
            if ('display_name' in obj_data) {
                apm_obj.display_name = obj_data.display_name;
                apm_obj.update_full_display_name();
            }
            // Update card image
            if ('images' in obj_data) {
                apm_obj.images = obj_data.images;
            }
            if ('background' in obj_data) {
                if (obj_data.background) {
                    apm_obj.html_elem.removeClass('nobackground');
                } else {
                    apm_obj.html_elem.addClass('nobackground');
                }
            }
            if ('default_face_up_offset' in obj_data) {
                apm_obj.dfuo = obj_data.default_face_up_offset;
            }
            if ('default_face_down_offset' in obj_data) {
                apm_obj.dfdo = obj_data.default_face_down_offset;
            }
            if ('dimensions' in obj_data) {
                apm_obj.dimensions = obj_data.dimensions.slice();
                should_sync_position = true;
            }
            if ('rotation' in obj_data) {
                apm_obj.rotation = obj_data.rotation;
                apm_obj.sync_rotation();
            }
            if ('rotate_by' in obj_data) {
                apm_obj.rotate_by = obj_data.rotate_by;
            }
            if ('can_rotate' in obj_data) {
                apm_obj.can_rotate = obj_data.can_rotate;
            }
            if ('show_face_number' in obj_data) {
                if (apm_obj.type === "Dice") {
                    var roll_count = obj_data.roll ? 10 : 0;
                    if (roll_count)
                        roll_count += Math.floor(Math.random() * 10);
                    apm_obj.start_roll(roll_count, obj_data.show_face_number);
                } else {
                    apm_obj.show_face_number = obj_data.show_face_number;
                    apm_obj.update_full_display_name();
                }
            }
            if ('background_color' in obj_data) {
                apm_obj.html_elem.css({"background": obj_data.background_color});
            }
            if ('force_card_depth' in obj_data) {
                apm_obj.force_card_depth = obj_data.force_card_depth;
            }
            if ('snap_card_to_grid' in obj_data) {
                apm_obj.snap_card_to_grid = obj_data.snap_card_to_grid;
            }
            // Sync card image changes
            apm_obj.sync_image();
            // Update info text
            apm.set_other_players_info_text();
            apm.set_private_hand_label_text();

            if (apm_obj.player_moving_index !== template_player_index && apm_obj !== currently_dragging) {
                if ('depth' in obj_data) {
                    apm_obj.depth = obj_data.depth;
                    should_sync_position = true;
                }
                if ('position' in obj_data) {
                    apm_obj.position = obj_data.position;
                    should_sync_position = true;
                }
                // Make changes to position visible in html
                if (should_sync_position) {
                    var moving = apm_obj.player_moving_index > -1;
                    apm_obj.sync_position(position_sync_time);
                    var dep_depth = apm_obj.depth + 1;
                    apm_obj.dependent_ids.forEach(function (d_id) {
                        var apm_dep = get_apm_obj(d_id);
                        if (! apm_dep)
                            return;
                        apm_dep.depth = dep_depth++;
                        apm_dep.position = apm_obj.position;
                        apm_dep.sync_position(position_sync_time);
                    });
                }
                setTimeout(sync_action_buttons, 400);
            } else {
                //console.log("Not syncing position because of player_moving_index");
            }
        });
    });

    var jwindow = $(window);
    var content = $( ".content" );
    var private_hand = $( "#private-hand" );
    var action_button_panel = $( "#action-button-panel" );
    var deal_spinner = $( "#deal-spinner" );
    var deal_button = $( "#deal-button" );
    var destroy_button = $( "#destroy-button" );
    var flip_button = $( "#flip-button");
    var shuffle_button = $( "#shuffle-button");
    var sort_button = $( "#sort-button" );
    var roll_button = $( "#roll-button" );
    var up_button = $( "#up-button" );
    var down_button = $( "#down-button" );
    var right_button = $( "#right-button" );
    var left_button = $( "#left-button" );
    var custom_text = $( "#custom-text" );
    var minimize_button = $( "#minimize-button" );
    var chat_window = $( "#chat-window" );
    var action_button_br = $( "#action-button-br" );
    var instructions_tab = $( "#instructions-tab" );
    var message_box = $( "#message-box" );
    var public_movables = $('#public-movables');
    var my_private_movables = $('#my-private-movables');
    var hidden_movables = $('#hidden-movables');
    var tooltip_panel = $('#tooltip-panel');

    apm.set_other_players_info_text();
    apm.set_private_hand_label_text();

    deal_spinner.spinner({min:1, max:20, step:1});
    var deal_spinner_parent = deal_spinner.parent();
    deal_button.click(function () {
        var id = apm.show_action_buttons_for_id;
        var which_face = "same face";
        var how_many = deal_spinner[0].value || 1;
        if (id) {
            socket.emit('DEAL', {gameid:template_gameid, obj_id:id, which_face:which_face, how_many:how_many});
        }
    });
    destroy_button.click(function () {
        var id = apm.show_action_buttons_for_id;
        if (id) {
            var apm_obj = get_apm_obj(id);
            var obj_string = apm_obj.type.toLowerCase();
            var deps = apm_obj.dependent_ids.length;
            if (deps > 0)
                obj_string += ' and '+deps+' other object';
            if (deps > 1)
                obj_string += 's';
            var confirm_message = "Permanently delete this "+obj_string+"?";
            if (confirm(confirm_message))
                socket.emit('DESTROY', {gameid:template_gameid, obj_id:id});
        }
    });
    roll_button.click(function () {
        var id = apm.show_action_buttons_for_id;
        if (id) {
            socket.emit('ROLL', {gameid:template_gameid, obj_id:id});
        }
        var apm_obj = get_apm_obj(id);
    });
    up_button.click(function () {
        var id = apm.show_action_buttons_for_id;
        if (id) {
            socket.emit('INCREMENT', {gameid:template_gameid, obj_id:id, amount:1});
        }
        var apm_obj = get_apm_obj(id);
    });
    down_button.click(function () {
        var id = apm.show_action_buttons_for_id;
        if (id) {
            socket.emit('INCREMENT', {gameid:template_gameid, obj_id:id, amount:-1});
        }
        var apm_obj = get_apm_obj(id);
    });
    flip_button.click(function () {
        var id = apm.show_action_buttons_for_id;
        if (id) {
            socket.emit('FLIP', {gameid:template_gameid, obj_id:id});
        }
    });
    shuffle_button.click(function () {
        var id = apm.show_action_buttons_for_id;
        if (id) {
            socket.emit('SHUFFLE', {gameid:template_gameid, obj_id:id});
        }
    });
    sort_button.click(function () {
        var id = apm.show_action_buttons_for_id;
        if (id) {
            socket.emit('SORT', {gameid:template_gameid, obj_id:id});
        }
    });
    right_button.click(function () {
        var id = apm.show_action_buttons_for_id;
        var amount = get_apm_obj(id).rotate_by
        if (id) {
            socket.emit('ROTATE', {gameid:template_gameid, obj_id:id, amount: amount});
        }
    });
    left_button.click(function () {
        var id = apm.show_action_buttons_for_id;
        var amount = get_apm_obj(id).rotate_by
        if (id) {
            socket.emit('ROTATE', {gameid:template_gameid, obj_id:id, amount: -amount});
        }
    });
    // If the user clicks on the background, take away the action buttons
     content.on('click', function (e) {
        if (e.target !== this)
            return;
        apm.show_action_buttons_for_id = false;
        sync_action_buttons();
    });
    private_hand.droppable({
        accept: function (el) {
            return el.hasClass('Card') || el.hasClass('Deck') || el.hasClass('Dice') || el.hasClass('NumberCard');
        },
        drop: function ( elem, ui ) {
            var top_id = ui.draggable.context.id;
            var apm_top = get_apm_obj(top_id);
            var now = new Date().getTime();

            // We want to prevent emitting the stop event after this
            apm_top.drop_time = now;
            apm_top.depth = get_dropped_public_depth();
            // Move the action buttons
            sync_action_buttons();
            var private_pos = get_position_array_from_html_pos(apm_top.html_elem.position());
            // If the object was public, we need to do a position offset
            if (apm_top.privacy === -1) {
                private_pos[0] += private_hand_horizontal_offset();
                private_pos[1] += private_hand_vertical_offset();
            }
            private_pos[0] -= apm_top.position_offset()[0];
            private_pos[1] -= apm_top.position_offset()[1];
            // Prevent more calls to emit_continue_moe
            apm_top.player_moving_index = -1;
            socket.emit('STOP MOVE', {
                gameid:template_gameid,
                obj_id:apm_top.id,
                position:private_pos,
                privacy:template_player_index
            });
        }
    });

    function once(fn, context) { 
	var result;
	return function() { 
	    if (fn) {
		result = fn.apply(context || this, arguments);
		fn = null;
	    }
	    return result;
	};
    }
    // Allow this function to be called once, then disable it
    var set_private_hand_once = once(function (height, bottom) {
        private_hand.css({'height': height - bottom});
    });

    var get_position_array_from_html_pos = function (html_pos) {
        var x = html_pos.left;
        var y = html_pos.top;
        return [x, y];
    };
    $("#private-hand").resizable({
        handles: {
            'n':'#handle'
        }
    });
    chat_window.tabs();
    chat_window.draggable({
       stop: function( event, ui ) {
	   $(this).css("top",parseInt($(this).css("top")) / ($(window).height() / 100)+"%");
       }
    });
    chat_window.resizable({
        handles: 's, w, sw',
    });
    // Since jquery doesn't want to show a sw handle, let's make it from the se!"
    $('.ui-resizable-sw').addClass('ui-icon').addClass('ui-icon-gripsmall-diagonal-se').addClass('rotate');
    // Draggability breaks the input focusability on mobile I guess, so this fixes it for mobile
    $('#chat-window input').click(function() {
        $(this).focus();
    });

    var message_waiting_to_send = false;
    var add_message_spinner = function () {
        if (message_waiting_to_send) {
            message_box.append('<div class="loader"></div>');
            message_box.stop(true, false).animate({scrollTop:message_box[0].scrollHeight}, {duration:300, queue:false});
        }
    };
    send_message = function (text) {
        if (! message_waiting_to_send) {
            message_waiting_to_send = true;
            setTimeout(add_message_spinner, 200);
            socket.emit('SEND MESSAGE', {
                gameid: template_gameid,
                text:   text
            });
        }
    };

    custom_text.on("keypress", function (e) {
        // If enter is pressed, and there isn't a message waiting to send, and the text box isn't empty, send the message
        if (e.keyCode == 13 && !message_waiting_to_send && custom_text.val().length > 0) {
            send_message(custom_text.val());
            custom_text.val("");
            return false;
        }
    });

    var maximize = function(){};

    minimize_button.on('click', function() {
        // Make the maximize function, which when called later will
        // resume the current dimensions
        var w = chat_window.width();
        var h = chat_window.height();
        maximize = function(){
            chat_window.css({
                'width':w,
                'height':h
            });
            minimize_button.show();
            //Disable the ability to hide a tab by clicking it
            chat_window.tabs('option', 'collapsible', false);
            chat_window.resizable('enable');
            maximize = function(){};
        };
        minimize_button.hide();
        // Shrink the chat_window and disable its resizable
        chat_window.css({
            'width':'80px',
            'height':'67px'
        });
        $('.ui-tabs-panel', chat_window).hide();
        chat_window.tabs('option', 'collapsible', true);
        chat_window.tabs('option', 'active', false);
        //chat_window.tabs('option', 'active', false);
        //$('.ui-tabs-active', chat_window).removeClass('ui-tabs-active ui-state-active');
        chat_window.resizable('disable');
    });
    $('.ui-tabs-tab', chat_window).on('click', function() {
        maximize();
    });
});
