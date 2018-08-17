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
        self.id = ko.observable(id);
        self.position = ko.observable(position);
        self.dimensions = ko.observable(dimensions);
        self.dependent_ids = ko.observableArray(dependent_ids);
        self.parent_id = ko.observable(get_apm_obj(parent_id));
        self.set_parent_id(parent_id);
        self.player_moving_index = ko.observable(-1);
        self.display_name = ko.observable(display_name);
        self.full_display_name = ko.pureComputed(function () {
            var text = self.display_name();
            var l = self.dependent_ids().length;
            if (l > 0)
                text += " ("+l+")";
            return text;
        });
        self.is_face_up = ko.observable(true);
        self.depth = ko.observable(0);
        self.type = ko.observable("");
        self.privacy = ko.observable(-1); //Index of player it is privately visible, -1 for public
        self.front_image_url = ko.observable(false);
        self.front_image_style = ko.observable("100% 100%");
        self.back_image_url = ko.observable('/static/images/freeplay/red_back.png');
        self.back_image_style = ko.observable("100% 100%");
        self.stack_group = ko.observable("");
        self.dfuo = ko.observableArray();
        self.dfdo = ko.observableArray();
        self.move_confirmed_by_server = false;
        self.html_elem = false;

        // Drop time works like this:
        // Dropping a card anywhere inhibits the stop drag event, and disallows another immediate general drop event
        // Dropping a card in the private area inhibits the stop drag event as well, but allows the general drop event to fire
        self.drop_time = 0;
        self.has_synced_once = false;
    }
    TableMovable.prototype.dimension_offset = function () {
            if (this.type() == 'Deck') {
                return [25, 45];
            }
            // Otherwise
            return [0, 0];
    };

    TableMovable.prototype.offset_per_dependent = function () {
        if (this.dependent_ids().length === 0) {
            return;
        }
        var first_dep = get_apm_obj(this.dependent_ids()[0]);
        if (! first_dep) {
            return;
        }
        var result;
        if (first_dep.is_face_up()) {
            result = first_dep.dfuo();
        } else {
            result = first_dep.dfdo();
        }
        if (!(result instanceof Array)) {
            // Result is actually a dict
            if (first_dep.privacy() === -1)
                result = result['public'];
            else
                result = result['private'];
        }
        return result;
    };

    TableMovable.prototype.get_index_in_parent = function () {
        var p = get_apm_obj(this.parent_id());
        if (! p)
            return 0;
        var i = p.dependent_ids().indexOf( this.id() );
        return Math.max(0, i);
    };

    TableMovable.prototype.position_offset = function () {
        if (this.type() == 'Deck') {
            return [-10, -27];
        } else if (this.type() == 'Card' && this.parent_id()) {
            var i = this.get_index_in_parent();
            var p = get_apm_obj(this.parent_id());
            var opd = [0.5, 0.5];
            if (p && p.offset_per_dependent()) {
                opd = p.offset_per_dependent().slice();
                opd[0] = Math.pow(Math.abs(opd[0] / 4), 2) * Math.sign(opd[0]);
                opd[1] = Math.pow(Math.abs(opd[1] / 4), 2) * Math.sign(opd[1]);
            }
            return [i * opd[0], i * opd[1]];
        }
        // Otherwise
        return [0, 0];
    };

    TableMovable.prototype.get_stack_group = function () {
        if (this.stack_group()) {
            return this.stack_group()
        } else if (this.dependent_ids().length) {
            return get_apm_obj(this.dependent_ids()[0]).stack_group();
        }
        return false;
    }
    TableMovable.prototype.sync_position = function (time) {
        if (time === undefined) {
            time = 200;
        }
        if (this.has_synced_once === false) {
            this.has_synced_once = true;
            time = 0;
        }
        // If the html_elem doesn't exist or is outdated (like from a private/public switch)
        if (! this.html_elem || this.html_elem.closest('body').length == 0)
            this.html_elem = $('#'+this.id());
        // Make the dimensions of a containing parent big enough to encompass its deps
        var width = this.dimensions()[0];
        var height = this.dimensions()[1];
        if (this.type() == "Deck" && this.dependent_ids().length) {
            var maxw = width; var maxh = height;
            this.dependent_ids().forEach(function (dep_id) {
                var apm_dep = get_apm_obj(dep_id);
                if (apm_dep) {
                    maxw = Math.max(maxw, apm_dep.position_offset()[0] + apm_dep.dimensions()[0]);
                    maxh = Math.max(maxh, apm_dep.position_offset()[1] + apm_dep.dimensions()[1]);
                }
            });
            width = maxw;
            height = maxh;
        }
        width += this.dimension_offset()[0];
        height += this.dimension_offset()[1];

        this.html_elem.css({
            "z-index": this.depth()
        });
        var css_obj = {
            "left":this.position()[0]+this.position_offset()[0],
            "top": this.position()[1]+this.position_offset()[1],
            "min-width": width,
            "height": height
        };
        if (time === 0) {
            this.html_elem.css( css_obj );
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
        if (this.is_face_up()) {
            this.html_elem.removeClass( 'back' );
            // If the card has an image, show it
            if (this.front_image_url()) {
                this.html_elem.css({
                    'background-image': "url("+this.front_image_url()+")",
                    'background-size': this.front_image_style()
                });
            }
        } else {
            this.html_elem.addClass( 'back' );
            if (this.back_image_url()) {
                this.html_elem.css({
                    'background-image': "url("+this.back_image_url()+")",
                    'background-size': this.back_image_style()
                });
            }
        }
    };
    TableMovable.prototype.change_privacy = function (privacy_index) {
        if (privacy_index === this.privacy())
            return;
        this.privacy(privacy_index);

        // If it is changing to a state visible to this user, it will need to have it's features reset
        if ( [-1, template_player_index].includes(this.privacy()) ) {
            this.sync_position(0);
            this.sync_image();
            // The changes need to reach the html before we can reference the object.
            ko.tasks.runEarly();
            // Recreate the jquery html elem
            this.html_elem = $('#'+this.id());
            // Get the listeners working again
            this.html_elem.draggable(draggable_settings);
            this.html_elem.click(clickable_settings);
            this.set_droppability();
        }
    };

    var private_hand_vertical_offset = function () {
        return content.offset().top - private_hand.offset().top + 2;
    };
    var private_hand_horizontal_offset = function () {
        return content.offset().left - private_hand.offset().left + 2;
    };

    var sync_action_buttons = function (should_hide) {
        // If the option buttons are attached to this object, move it too.
        var html_obj = $( '#'+apm.show_action_buttons_for_id());
        var apm_obj = get_apm_obj(apm.show_action_buttons_for_id());
        var html_pos = html_obj.position();
        if (!should_hide && html_pos) {
            var position_type = 'absolute';
            if (apm_obj.privacy() !== -1) {
                position_type = 'fixed';
                // Since it's private, get the position relative to the screen
                html_pos = html_obj.offset();
                html_pos.top -= jwindow.scrollTop();
                html_pos.left -= jwindow.scrollLeft();
            }
            // Put in or take out the deck specific controls
            if (apm_obj.type() == "Deck") {
                action_button_panel.prepend(action_button_br);
                action_button_panel.prepend(deal_button);
                action_button_panel.prepend(deal_spinner_parent);
                action_button_panel.append(shuffle_button);
                action_button_panel.append(sort_button);
            } else {
                action_button_br.detach();
                deal_button.detach();
                deal_spinner_parent.detach();
                shuffle_button.detach();
                sort_button.detach();
            }
            var height = action_button_panel.height();
            action_button_panel.css({
                "left":html_pos.left+4,
                "top": html_pos.top-height - 2,
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
        if (this.parent_id() === pid)
            return;
        // Remove from old parent dependents if possible
        var obj_old_parent = get_apm_obj( this.parent_id() );
        if (obj_old_parent) {
            var array = obj_old_parent.dependent_ids;
            var index = $.inArray(this.id(), array());
            if (index >= 0)
                array.splice( index, 1);
        }
        // Set new parent
        this.parent_id( pid );
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
            if (! obj_parent.dependent_ids().includes(this.id()) )
                obj_parent.dependent_ids.push(this.id());
        }
        this.set_droppability();
    };

    /* If the object has no parent, give it droppability. Otherwise take it away.
     */
    TableMovable.prototype.set_droppability = function () {
        // If the html_elem doesn't exist or is outdated (like from a private/public switch)
        if (! this.html_elem || this.html_elem.closest('body').length == 0)
            this.html_elem = $('#'+this.id());
        if ( this.parent_id() === false || this.parent_id() === undefined ) {
            this.html_elem.droppable(droppable_settings);
        } else {
            try {
                this.html_elem.droppable("destroy");
            } catch (err) {}
        }
    };

    function AppViewModel() {
        var self = this;
        self.players = ko.observableArray([]);
        self.quick_messages = ko.observableArray(["I win!", "Good game", "Your turn"]);
        self.messages = ko.observableArray([]);
        self.movables = ko.observableArray([]);
        self.my_player_index = template_player_index;
        self.show_action_buttons_for_id = ko.observable(false);
        self.public_movables = ko.pureComputed(function () {
            return ko.utils.arrayFilter(self.movables(), function (m) {return m.privacy() === -1;});
        });
        self.my_private_movables = ko.pureComputed(function () {
            return ko.utils.arrayFilter(self.movables(), function (m) {return m.privacy() === self.my_player_index;});
        });
        self.private_card_count = function (player_index) {
            return ko.utils.arrayFilter(self.movables(), function (m) {
                return m.privacy() == player_index && m.type() === 'Card';
            }).length;
        };
        self.private_hand_label_text = ko.pureComputed(function () {
            var text = "Your private hand";
            var num_cards = self.private_card_count(template_player_index);
            if (num_cards > 0)
                text += " ("+num_cards+")";
            return text;
        });
        self.other_players_info_text = ko.pureComputed(function () {
            var text = "";
            var no_one = true;
            for (var i=0; i<self.players().length; i++) {
                if (i == template_player_index)
                    continue;
                no_one = false;
                text += ", "; // We remove the first of these after
                text += '<span class="player-color-'+(i%6)+'">';
                text += self.players()[i];
                var num_cards = self.private_card_count(i);
                text += '</span>';
                if (num_cards > 0)
                    text += " ("+num_cards+")";
            }
            text = text.substring(2); // Remove first ", "
            text = "Other players: "+text;
            if (no_one)
                text = "No one else has joined your game yet. Have you given them your url?";
            return text;
        });
    }

    // Activates knockout.js
    ko.options.deferUpdates = true;
    apm = new AppViewModel();
    ko.applyBindings(apm);
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

    function createBasicTableMovable(id) {
        var apm_obj = new TableMovable(id, [0, 0], [0, 0], [], false, undefined);
        // Add it to the html
        apm.movables.push(apm_obj);
        // To do things with the html object, we have to run ko notifications now
        ko.tasks.runEarly();
        // Give it its html_elem
        apm_obj.html_elem = $( '#'+apm_obj.id() );
        // Make it draggable and droppable
        apm_obj.html_elem.draggable(draggable_settings);
        apm_obj.html_elem.droppable(droppable_settings);
        apm_obj.html_elem.click(clickable_settings);
        apm_obj.set_droppability();

        return apm_obj;
    }

    clickable_settings =  function () {
        // If we clicked on the same one again, hide the button
        if (apm.show_action_buttons_for_id() === this.id) {
            apm.show_action_buttons_for_id(false);
            sync_action_buttons();
        }
        else {
            apm.show_action_buttons_for_id(this.id);
            sync_action_buttons();
        }
    };

    draggable_settings = {
            start: function (elem) {
                var html_elem = $('#'+elem.target.id);
                // This will prevent a click event being triggered at drop time
                socket.emit('START MOVE', {gameid:template_gameid, obj_id:elem.target.id});
                var apm_obj = get_apm_obj(elem.target.id);
                html_elem.css({'z-index':get_dragging_depth()});
                currently_dragging = apm_obj;
                // Start all of the dependents dragging as well
                apm_obj.dependent_ids().forEach(function (d_id) {
                    var apm_dep = get_apm_obj(d_id);
                    if (! apm_dep)
                        return;
                    apm_dep.depth(get_dragging_depth());
                    apm_dep.sync_position(0);
                });
                // Remove this object from its parents
                apm_obj.set_parent_id(false);
                // Hide action buttons for duration of drag
                sync_action_buttons(true);
                // If the action buttons are on another element, switch them to this element
                var follow_id = apm.show_action_buttons_for_id();
                if (follow_id && follow_id !== apm_obj.id()) {
                    apm.show_action_buttons_for_id(apm_obj.id());
                }
            },
            drag: function (elem) {
                var html_elem = $('#'+elem.target.id);
                var apm_obj = get_apm_obj(elem.target.id);
                var pos = get_position_array_from_html_pos(html_elem.position());
                pos[0] -= apm_obj.position_offset()[0];
                pos[1] -= apm_obj.position_offset()[1];
                apm_obj.position(pos);
                // Move all the dependents as well
                apm_obj.dependent_ids().forEach(function (d_id) {
                    var apm_dep = get_apm_obj(d_id);
                    if (! apm_dep)
                        return;
                    apm_dep.position(pos);
                    apm_dep.sync_position(0);
                });
                // Only send a server update if enough time has passed since the last
                var now = new Date().getTime();
                if (now - time_of_drag_emit > 400) {
                    time_of_drag_emit = now;
                    socket.emit('CONTINUE MOVE', {gameid:template_gameid, obj_id:elem.target.id, position:pos});
                }
            },
            stop: function (elem) {
                var apm_obj = get_apm_obj(elem.target.id);
                currently_dragging = false;
                var now = new Date().getTime();
                if (now - apm_obj.drop_time > 200) {
                    var html_elem = $('#'+elem.target.id);
                    var pos = get_position_array_from_html_pos(html_elem.position());
                    pos[0] -= apm_obj.position_offset()[0];
                    pos[1] -= apm_obj.position_offset()[1];
                    apm_obj.depth(get_dropped_public_depth());
                    apm_obj.position(pos);
                    apm_obj.sync_position(0);
                    // Move all the dependents as well
                    apm_obj.dependent_ids().forEach(function (d_id) {
                        var apm_dep = get_apm_obj(d_id);
                        if (! apm_dep)
                            return;
                        apm_dep.depth(get_dropped_public_depth());
                        apm_dep.position(pos);
                        apm_dep.sync_position(0);
                    });
                    // If the object was private, we need to do a position offset
                    if (apm_obj.privacy() !== -1) {
                        pos[0] -= private_hand_horizontal_offset();
                        pos[1] -= private_hand_vertical_offset();
                    }
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
            return el.hasClass('Card') || el.hasClass('Deck');
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
            if (apm_bottom.privacy() === -1 && top_middle_y > private_hand.offset().top) {
                console.log('elem is below private hand line, won\'t trigger public drop');
                return;
            }
            if (apm_top.dependent_ids().includes(bottom_id)) {
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
            if (!['Deck', 'Card'].includes(apm_top.type()) || !['Deck', 'Card'].includes(apm_bottom.type()))
                return;
            // We want to prevent emitting the stop event after this
            apm_top.drop_time = now;
            apm_top.depth(get_dragging_depth());
            apm_top.dependent_ids().forEach(function (d_id) {
                var apm_dep = get_apm_obj(d_id);
                if (! apm_dep)
                    return;
                apm_dep.depth(get_dragging_depth());
                apm_dep.sync_position(0);
            });
            apm_top.sync_position();
            // Move the action buttons
            sync_action_buttons();
            // Tell the server to combine the two
            socket.emit('COMBINE', {gameid:template_gameid, top_id:top_id, bottom_id:bottom_id});
        }
    };

    // Knockout helper functions
    get_apm_obj = function (oid) {
        var poss = apm.movables().filter(function (apm_p) {return apm_p.id() == oid;});
        if (poss.length > 0) {
            return poss[0];
        } else {
            //console.log("No such movable: "+oid);
        }
    };

    // Socketio functions
    socket.on('SHOULD REQUEST UPDATE', function (data) {
       request_update();
    });

    var request_update = function () {
        socket.emit('UPDATE REQUEST', {gameid:template_gameid});
    };

    socket.on('connect', function () {
        socket.emit('JOIN ROOM', {room:template_gameid});
        request_update();
    });

    socket.on('UPDATE', function (d) {
        const data = d;
        deepFreeze(data);
        if (data.players) {
            apm.players(data.players.slice());
        }
        // quick_messages update
        if (data.quick_messages) {
            var qms = [];
            for (var i=0; i<apm.players().length; i++)
                qms.push('$*'+i+'@'+apm.players()[i]);
            qms = qms.concat(data.quick_messages);
            apm.quick_messages(qms);
        }
        // Instructions update
        if (data.instructions_html) {
            instructions_tab.html(data.instructions_html);
        }
        //Messages update
        if (data.messages) {
            apm.messages(data.messages);
            var html_string = "";
            var last_time = 0;
            var last_player_index = -1;
            data.messages.forEach(function (m) {
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
                    html_string += '<span class="message-name player-color-'+(i%6)+'">'+apm.players()[m.player_index]+':</span><br>';
                }
                last_time = m.timestamp;
                last_player_index = m.player_index;
                var text = m.text;
                // Escape the html to keep everyone safe from nasties ;)
                text = escapeHtml(m.text);
                // decode utf8 stuff so emojis and stuff are right (this has to come after)
                text = decodeURIComponent(escape(text));
                // If there is a color prefix, add that class
                var class_string = "message-text";
                if (text.startsWith("$*")) {
                    class_string += ' player-color-'+(text.substring(2, 3) % 6);
                    text = text.substring(3);
                }
                html_string += '<span class="'+class_string+'">'+text+'</span><br>';
            });
            message_box.html(html_string);
            // Scroll to the bottom:
            message_box.stop(true, false).animate({scrollTop:message_box.scrollHeight}, {duration:300, queue:false});
            // Remove the bar on sending more messages
            message_waiting_to_send = false;

        }
        //Movables changes
        if (! data.movables_info)
            return;
        data.movables_info.forEach(function (obj_data) {
            var apm_obj = get_apm_obj(obj_data.id);
            if (apm_obj === currently_dragging)
                return;
            var position_sync_time = 500;
            var should_sync_position = false;
            if (!apm_obj) {
                //Create the obj if it doesn't exist yet.
                apm_obj = createBasicTableMovable(obj_data.id);
                position_sync_time = 0;
                should_sync_position = true;
            }
            // If the html_elem doesn't exist or is outdated (like from a private/public switch)
            if (! apm_obj.html_elem || apm_obj.html_elem.closest('body').length == 0)
                apm_obj.html_elem = $('#'+apm_obj.id());

            //Update its info
            if ('dependents' in obj_data) {
                obj_data.dependents.forEach(function (did) {
                    var dep_obj = get_apm_obj(did);
                    if (dep_obj)
                        dep_obj.set_parent_id( apm_obj.id() );
                });
                // Make sure the order is right:
                apm_obj.dependent_ids(obj_data.dependents.slice());
            }
            if ('destroy' in obj_data && obj_data.destroy == true) {
                console.log('destroying '+apm_obj.id());
                // Make all the dependents orphans
                apm_obj.dependent_ids().forEach(function (did) {
                    var dep_obj = get_apm_obj(did);
                    if (dep_obj)
                        dep_obj.set_parent_id(false);
                });
                // If the action buttons were attached to it, detach them
                if (apm.show_action_buttons_for_id() == apm_obj.id()) {
                    apm.show_action_buttons_for_id(false);
                    sync_action_buttons();
                }
                // Remove from the movables array
                apm.movables.splice( $.inArray(apm_obj, apm.movables()), 1);
                return;
            }
            if ('parent' in obj_data)
                apm_obj.set_parent_id( obj_data.parent );
            if ('stack_group' in obj_data)
                apm_obj.stack_group(obj_data.stack_group);
            if ('player_moving_index' in obj_data) {
                apm_obj.player_moving_index( obj_data.player_moving_index );
            }
            if ('privacy' in obj_data) {
                if (obj_data.privacy != apm_obj.privacy())
                    position_sync_time = 0;
                apm_obj.change_privacy(obj_data.privacy);
                apm_obj.dependent_ids().forEach(function (did) {
                    var dep_obj = get_apm_obj(did);
                    if (dep_obj) {
                        dep_obj.change_privacy(obj_data.privacy);
                        dep_obj.sync_image();
                    }
                });
                // The html_elem has changed
                apm_obj.html_elem = $('#'+apm_obj.id());
            }
            if ('type' in obj_data) {
                apm_obj.type( obj_data.type );
            }
            if ('display_name' in obj_data) {
                apm_obj.display_name( obj_data.display_name );
                // Redirect clicks on the text to the parent
                var span = $( 'span', apm_obj.html_elem );
                span.off('click').on('click', function () {
                    apm_obj.html_elem.trigger('click');
                });
            }
            // Update card image
            if ('front_image_url' in obj_data) {
                apm_obj.front_image_url( obj_data.front_image_url );
            }
            if ('front_image_style' in obj_data) {
                apm_obj.front_image_style( obj_data.front_image_style );
            }
            if ('back_image_url' in obj_data) {
                apm_obj.back_image_url( obj_data.back_image_url );
            }
            if ('back_image_style' in obj_data) {
                apm_obj.back_image_style( obj_data.back_image_style );
            }
            if ('default_face_up_offset' in obj_data) {
                apm_obj.dfuo( obj_data.default_face_up_offset );
            }
            if ('default_face_down_offset' in obj_data) {
                apm_obj.dfdo( obj_data.default_face_down_offset );
            }
            if ('is_face_up' in obj_data) {
                apm_obj.is_face_up( obj_data.is_face_up );
            }
            // Sync card image changes
            apm_obj.sync_image();

            if (apm_obj.player_moving_index() !== template_player_index && apm_obj !== currently_dragging) {
                if ('depth' in obj_data) {
                    apm_obj.depth( obj_data.depth );
                    should_sync_position = true;
                }
                if ('position' in obj_data) {
                    apm_obj.position( obj_data.position );
                    should_sync_position = true;
                }
                if ('dimensions' in obj_data) {
                    apm_obj.dimensions( obj_data.dimensions.slice() );
                    should_sync_position = true;
                }
                // Make changes to position visible in html
                if (should_sync_position) {
                    var moving = apm_obj.player_moving_index() > -1;
                    apm_obj.sync_position(position_sync_time);
                    apm_obj.dependent_ids().forEach(function (d_id) {
                        var apm_dep = get_apm_obj(d_id);
                        if (! apm_dep)
                            return;
                        apm_dep.depth(moving ? get_dragging_depth() : get_dropped_public_depth());
                        apm_dep.position(apm_obj.position());
                        apm_dep.sync_position(position_sync_time);
                    });
                }
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
    var custom_text = $( "#custom-text" );
    var chat_window = $( "#chat-window" );
    var action_button_br = $( "#action-button-br" );
    var instructions_tab = $( "#instructions-tab" );
    var message_box = $( "#message-box" );

    deal_spinner.spinner({min:1, max:20, step:1});
    var deal_spinner_parent = deal_spinner.parent();
    deal_button.click(function () {
        var id = apm.show_action_buttons_for_id();
        var which_face = "same face"; 
        var how_many = deal_spinner[0].value || 1;
        if (id) {
            socket.emit('DEAL', {gameid:template_gameid, obj_id:id, which_face:which_face, how_many:how_many});
        }
    });
    destroy_button.click(function () {
        var id = apm.show_action_buttons_for_id();
        if (id) {
            var apm_obj = get_apm_obj(id);
            var obj_string = apm_obj.type().toLowerCase();
            var deps = apm_obj.dependent_ids().length;
            if (deps > 0)
                obj_string += ' and '+deps+' other object';
            if (deps > 1)
                obj_string += 's';
            var confirm_message = "Permanently delete this "+obj_string+"?";
            if (confirm(confirm_message))
                socket.emit('DESTROY', {gameid:template_gameid, obj_id:id});
        }
    });
    flip_button.click(function () {
        var id = apm.show_action_buttons_for_id();
        if (id) {
            socket.emit('FLIP', {gameid:template_gameid, obj_id:id});
        }
    });
    shuffle_button.click(function () {
        var id = apm.show_action_buttons_for_id();
        if (id) {
            socket.emit('SHUFFLE', {gameid:template_gameid, obj_id:id});
        }
    });
    sort_button.click(function () {
        var id = apm.show_action_buttons_for_id();
        if (id) {
            socket.emit('SORT', {gameid:template_gameid, obj_id:id});
        }
    });
    // If the user clicks on the background, take away the action buttons
     content.on('click', function (e) {
        if (e.target !== this)
            return;
        apm.show_action_buttons_for_id(false);
        sync_action_buttons();
    });
    private_hand.droppable({
        accept: function (el) {
            return el.hasClass('Card') || el.hasClass('Deck');
        },
        drop: function ( elem, ui ) {
            var top_id = ui.draggable.context.id;
            var apm_top = get_apm_obj(top_id);
            var now = new Date().getTime();

            // We want to prevent emitting the stop event after this
            apm_top.drop_time = now;
            //apm_top.position( apm_bottom.position() );
            apm_top.depth(get_dropped_public_depth());
            // Move the action buttons
            sync_action_buttons();
            var private_pos = get_position_array_from_html_pos(apm_top.html_elem.position());
            // If the object was public, we need to do a position offset
            if (apm_top.privacy() === -1) {
                private_pos[0] += private_hand_horizontal_offset();
                private_pos[1] += private_hand_vertical_offset();
            }
            private_pos[0] -= apm_top.position_offset()[0];
            private_pos[1] -= apm_top.position_offset()[1];
            socket.emit('STOP MOVE', {
                gameid:template_gameid,
                obj_id:apm_top.id(),
                position:private_pos,
                privacy:template_player_index
            });
        }
    });
    var get_position_array_from_html_pos = function (html_pos) {
        var x = html_pos.left;
        var y = html_pos.top;
        return [x, y];
    };
    $(".resizable").resizable({
        handles: {
            'n':'#handle'
        }
    });
    chat_window.tabs();
    chat_window.draggable();
    chat_window.resizable();
    var message_waiting_to_send = false;
    var add_message_spinner = function () {
        if (message_waiting_to_send) {
            message_box.stop(true, false).animate({scrollTop:message_box.scrollHeight}, {duration:300, queue:false});
            message_box.append('<div class="loader"></div>');
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
});
