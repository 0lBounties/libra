var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function null_to_empty(value) {
        return value == null ? '' : value;
    }
    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function custom_event(type, detail, bubbles = false) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, bubbles, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    function onDestroy(fn) {
        get_current_component().$$.on_destroy.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }

    const globals = (typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : global);
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.44.2' }, detail), true));
    }
    function append_dev(target, node) {
        dispatch_dev('SvelteDOMInsert', { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev('SvelteDOMInsert', { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev('SvelteDOMRemove', { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation) {
        const modifiers = options === true ? ['capture'] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        dispatch_dev('SvelteDOMAddEventListener', { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev('SvelteDOMRemoveEventListener', { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev('SvelteDOMRemoveAttribute', { node, attribute });
        else
            dispatch_dev('SvelteDOMSetAttribute', { node, attribute, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.wholeText === data)
            return;
        dispatch_dev('SvelteDOMSetData', { node: text, data });
        text.data = data;
    }
    function validate_each_argument(arg) {
        if (typeof arg !== 'string' && !(arg && typeof arg === 'object' && 'length' in arg)) {
            let msg = '{#each} only iterates over array-like objects.';
            if (typeof Symbol === 'function' && arg && Symbol.iterator in arg) {
                msg += ' You can use a spread to convert this iterable into an array.';
            }
            throw new Error(msg);
        }
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    /**
     * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
     */
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    /* src/components/layout/Nav.svelte generated by Svelte v3.44.2 */

    const file$i = "src/components/layout/Nav.svelte";

    function create_fragment$i(ctx) {
    	let main;
    	let nav;
    	let div;
    	let ul;
    	let li0;
    	let a0;
    	let t1;
    	let li1;
    	let a1;
    	let t3;
    	let li2;
    	let a2;
    	let t5;
    	let li3;
    	let a3;
    	let t7;
    	let li4;
    	let a4;
    	let t9;
    	let li5;
    	let a5;

    	const block = {
    		c: function create() {
    			main = element("main");
    			nav = element("nav");
    			div = element("div");
    			ul = element("ul");
    			li0 = element("li");
    			a0 = element("a");
    			a0.textContent = "Dash";
    			t1 = space();
    			li1 = element("li");
    			a1 = element("a");
    			a1.textContent = "Validators";
    			t3 = space();
    			li2 = element("li");
    			a2 = element("a");
    			a2.textContent = "Autopay";
    			t5 = space();
    			li3 = element("li");
    			a3 = element("a");
    			a3.textContent = "Watch List";
    			t7 = space();
    			li4 = element("li");
    			a4 = element("a");
    			a4.textContent = "Audit";
    			t9 = space();
    			li5 = element("li");
    			a5 = element("a");
    			a5.textContent = "Upgrades";
    			attr_dev(a0, "href", "#");
    			add_location(a0, file$i, 4, 30, 226);
    			attr_dev(li0, "class", "uk-active");
    			add_location(li0, file$i, 4, 8, 204);
    			attr_dev(a1, "href", "#");
    			add_location(a1, file$i, 5, 12, 264);
    			add_location(li1, file$i, 5, 8, 260);
    			attr_dev(a2, "href", "#");
    			add_location(a2, file$i, 6, 12, 308);
    			add_location(li2, file$i, 6, 8, 304);
    			attr_dev(a3, "href", "#");
    			add_location(a3, file$i, 7, 12, 349);
    			add_location(li3, file$i, 7, 8, 345);
    			attr_dev(a4, "href", "#");
    			add_location(a4, file$i, 8, 12, 393);
    			add_location(li4, file$i, 8, 8, 389);
    			attr_dev(a5, "href", "#");
    			add_location(a5, file$i, 9, 12, 432);
    			add_location(li5, file$i, 9, 8, 428);
    			attr_dev(ul, "class", "uk-navbar-nav uk-text-center");
    			attr_dev(ul, "uk-switcher", "connect: .switcher-container");
    			add_location(ul, file$i, 3, 6, 111);
    			attr_dev(div, "class", "uk-navbar-center uk-overflow-auto");
    			add_location(div, file$i, 2, 4, 57);
    			attr_dev(nav, "class", "uk-navbar-container");
    			attr_dev(nav, "uk-navbar", "");
    			add_location(nav, file$i, 1, 2, 9);
    			add_location(main, file$i, 0, 0, 0);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			append_dev(main, nav);
    			append_dev(nav, div);
    			append_dev(div, ul);
    			append_dev(ul, li0);
    			append_dev(li0, a0);
    			append_dev(ul, t1);
    			append_dev(ul, li1);
    			append_dev(li1, a1);
    			append_dev(ul, t3);
    			append_dev(ul, li2);
    			append_dev(li2, a2);
    			append_dev(ul, t5);
    			append_dev(ul, li3);
    			append_dev(li3, a3);
    			append_dev(ul, t7);
    			append_dev(ul, li4);
    			append_dev(li4, a4);
    			append_dev(ul, t9);
    			append_dev(ul, li5);
    			append_dev(li5, a5);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$i.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$i($$self, $$props) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Nav', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Nav> was created with unknown prop '${key}'`);
    	});

    	return [];
    }

    class Nav extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$i, create_fragment$i, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Nav",
    			options,
    			id: create_fragment$i.name
    		});
    	}
    }

    /* src/components/monitor/health/Check.svelte generated by Svelte v3.44.2 */

    const file$h = "src/components/monitor/health/Check.svelte";

    // (13:4) {:else}
    function create_else_block$8(ctx) {
    	let span;

    	const block = {
    		c: function create() {
    			span = element("span");
    			attr_dev(span, "class", "uk-margin-small-right uk-text-warning");
    			attr_dev(span, "uk-icon", "icon: warning; ratio: 1");
    			add_location(span, file$h, 13, 6, 284);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, span, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(span);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block$8.name,
    		type: "else",
    		source: "(13:4) {:else}",
    		ctx
    	});

    	return block;
    }

    // (8:4) {#if isTrue}
    function create_if_block$b(ctx) {
    	let span;

    	const block = {
    		c: function create() {
    			span = element("span");
    			attr_dev(span, "class", "uk-margin-small-right uk-text-success");
    			attr_dev(span, "uk-icon", "icon: check; ratio: 1");
    			add_location(span, file$h, 8, 6, 157);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, span, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(span);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$b.name,
    		type: "if",
    		source: "(8:4) {#if isTrue}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$h(ctx) {
    	let div;
    	let dt;
    	let t0;
    	let span;
    	let t1;
    	let t2;
    	let dd;
    	let t3;

    	function select_block_type(ctx, dirty) {
    		if (/*isTrue*/ ctx[0]) return create_if_block$b;
    		return create_else_block$8;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block = current_block_type(ctx);

    	const block = {
    		c: function create() {
    			div = element("div");
    			dt = element("dt");
    			if_block.c();
    			t0 = space();
    			span = element("span");
    			t1 = text(/*title*/ ctx[1]);
    			t2 = space();
    			dd = element("dd");
    			t3 = text(/*description*/ ctx[2]);
    			attr_dev(span, "class", "uk-text-uppercase");
    			add_location(span, file$h, 18, 4, 409);
    			add_location(dt, file$h, 6, 2, 129);
    			add_location(dd, file$h, 20, 2, 468);
    			add_location(div, file$h, 5, 0, 121);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, dt);
    			if_block.m(dt, null);
    			append_dev(dt, t0);
    			append_dev(dt, span);
    			append_dev(span, t1);
    			append_dev(div, t2);
    			append_dev(div, dd);
    			append_dev(dd, t3);
    		},
    		p: function update(ctx, [dirty]) {
    			if (current_block_type !== (current_block_type = select_block_type(ctx))) {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(dt, t0);
    				}
    			}

    			if (dirty & /*title*/ 2) set_data_dev(t1, /*title*/ ctx[1]);
    			if (dirty & /*description*/ 4) set_data_dev(t3, /*description*/ ctx[2]);
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			if_block.d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$h.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$h($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Check', slots, []);
    	let { isTrue = true } = $$props;
    	let { title = undefined } = $$props;
    	let { description = undefined } = $$props;
    	const writable_props = ['isTrue', 'title', 'description'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Check> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ('isTrue' in $$props) $$invalidate(0, isTrue = $$props.isTrue);
    		if ('title' in $$props) $$invalidate(1, title = $$props.title);
    		if ('description' in $$props) $$invalidate(2, description = $$props.description);
    	};

    	$$self.$capture_state = () => ({ isTrue, title, description });

    	$$self.$inject_state = $$props => {
    		if ('isTrue' in $$props) $$invalidate(0, isTrue = $$props.isTrue);
    		if ('title' in $$props) $$invalidate(1, title = $$props.title);
    		if ('description' in $$props) $$invalidate(2, description = $$props.description);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [isTrue, title, description];
    }

    class Check extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$h, create_fragment$h, safe_not_equal, { isTrue: 0, title: 1, description: 2 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Check",
    			options,
    			id: create_fragment$h.name
    		});
    	}

    	get isTrue() {
    		throw new Error("<Check>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set isTrue(value) {
    		throw new Error("<Check>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get title() {
    		throw new Error("<Check>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set title(value) {
    		throw new Error("<Check>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get description() {
    		throw new Error("<Check>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set description(value) {
    		throw new Error("<Check>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

    function createCommonjsModule(fn) {
      var module = { exports: {} };
    	return fn(module, module.exports), module.exports;
    }

    /**
     * @license
     * Lodash <https://lodash.com/>
     * Copyright OpenJS Foundation and other contributors <https://openjsf.org/>
     * Released under MIT license <https://lodash.com/license>
     * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
     * Copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
     */

    var lodash = createCommonjsModule(function (module, exports) {
    (function() {

      /** Used as a safe reference for `undefined` in pre-ES5 environments. */
      var undefined$1;

      /** Used as the semantic version number. */
      var VERSION = '4.17.21';

      /** Used as the size to enable large array optimizations. */
      var LARGE_ARRAY_SIZE = 200;

      /** Error message constants. */
      var CORE_ERROR_TEXT = 'Unsupported core-js use. Try https://npms.io/search?q=ponyfill.',
          FUNC_ERROR_TEXT = 'Expected a function',
          INVALID_TEMPL_VAR_ERROR_TEXT = 'Invalid `variable` option passed into `_.template`';

      /** Used to stand-in for `undefined` hash values. */
      var HASH_UNDEFINED = '__lodash_hash_undefined__';

      /** Used as the maximum memoize cache size. */
      var MAX_MEMOIZE_SIZE = 500;

      /** Used as the internal argument placeholder. */
      var PLACEHOLDER = '__lodash_placeholder__';

      /** Used to compose bitmasks for cloning. */
      var CLONE_DEEP_FLAG = 1,
          CLONE_FLAT_FLAG = 2,
          CLONE_SYMBOLS_FLAG = 4;

      /** Used to compose bitmasks for value comparisons. */
      var COMPARE_PARTIAL_FLAG = 1,
          COMPARE_UNORDERED_FLAG = 2;

      /** Used to compose bitmasks for function metadata. */
      var WRAP_BIND_FLAG = 1,
          WRAP_BIND_KEY_FLAG = 2,
          WRAP_CURRY_BOUND_FLAG = 4,
          WRAP_CURRY_FLAG = 8,
          WRAP_CURRY_RIGHT_FLAG = 16,
          WRAP_PARTIAL_FLAG = 32,
          WRAP_PARTIAL_RIGHT_FLAG = 64,
          WRAP_ARY_FLAG = 128,
          WRAP_REARG_FLAG = 256,
          WRAP_FLIP_FLAG = 512;

      /** Used as default options for `_.truncate`. */
      var DEFAULT_TRUNC_LENGTH = 30,
          DEFAULT_TRUNC_OMISSION = '...';

      /** Used to detect hot functions by number of calls within a span of milliseconds. */
      var HOT_COUNT = 800,
          HOT_SPAN = 16;

      /** Used to indicate the type of lazy iteratees. */
      var LAZY_FILTER_FLAG = 1,
          LAZY_MAP_FLAG = 2,
          LAZY_WHILE_FLAG = 3;

      /** Used as references for various `Number` constants. */
      var INFINITY = 1 / 0,
          MAX_SAFE_INTEGER = 9007199254740991,
          MAX_INTEGER = 1.7976931348623157e+308,
          NAN = 0 / 0;

      /** Used as references for the maximum length and index of an array. */
      var MAX_ARRAY_LENGTH = 4294967295,
          MAX_ARRAY_INDEX = MAX_ARRAY_LENGTH - 1,
          HALF_MAX_ARRAY_LENGTH = MAX_ARRAY_LENGTH >>> 1;

      /** Used to associate wrap methods with their bit flags. */
      var wrapFlags = [
        ['ary', WRAP_ARY_FLAG],
        ['bind', WRAP_BIND_FLAG],
        ['bindKey', WRAP_BIND_KEY_FLAG],
        ['curry', WRAP_CURRY_FLAG],
        ['curryRight', WRAP_CURRY_RIGHT_FLAG],
        ['flip', WRAP_FLIP_FLAG],
        ['partial', WRAP_PARTIAL_FLAG],
        ['partialRight', WRAP_PARTIAL_RIGHT_FLAG],
        ['rearg', WRAP_REARG_FLAG]
      ];

      /** `Object#toString` result references. */
      var argsTag = '[object Arguments]',
          arrayTag = '[object Array]',
          asyncTag = '[object AsyncFunction]',
          boolTag = '[object Boolean]',
          dateTag = '[object Date]',
          domExcTag = '[object DOMException]',
          errorTag = '[object Error]',
          funcTag = '[object Function]',
          genTag = '[object GeneratorFunction]',
          mapTag = '[object Map]',
          numberTag = '[object Number]',
          nullTag = '[object Null]',
          objectTag = '[object Object]',
          promiseTag = '[object Promise]',
          proxyTag = '[object Proxy]',
          regexpTag = '[object RegExp]',
          setTag = '[object Set]',
          stringTag = '[object String]',
          symbolTag = '[object Symbol]',
          undefinedTag = '[object Undefined]',
          weakMapTag = '[object WeakMap]',
          weakSetTag = '[object WeakSet]';

      var arrayBufferTag = '[object ArrayBuffer]',
          dataViewTag = '[object DataView]',
          float32Tag = '[object Float32Array]',
          float64Tag = '[object Float64Array]',
          int8Tag = '[object Int8Array]',
          int16Tag = '[object Int16Array]',
          int32Tag = '[object Int32Array]',
          uint8Tag = '[object Uint8Array]',
          uint8ClampedTag = '[object Uint8ClampedArray]',
          uint16Tag = '[object Uint16Array]',
          uint32Tag = '[object Uint32Array]';

      /** Used to match empty string literals in compiled template source. */
      var reEmptyStringLeading = /\b__p \+= '';/g,
          reEmptyStringMiddle = /\b(__p \+=) '' \+/g,
          reEmptyStringTrailing = /(__e\(.*?\)|\b__t\)) \+\n'';/g;

      /** Used to match HTML entities and HTML characters. */
      var reEscapedHtml = /&(?:amp|lt|gt|quot|#39);/g,
          reUnescapedHtml = /[&<>"']/g,
          reHasEscapedHtml = RegExp(reEscapedHtml.source),
          reHasUnescapedHtml = RegExp(reUnescapedHtml.source);

      /** Used to match template delimiters. */
      var reEscape = /<%-([\s\S]+?)%>/g,
          reEvaluate = /<%([\s\S]+?)%>/g,
          reInterpolate = /<%=([\s\S]+?)%>/g;

      /** Used to match property names within property paths. */
      var reIsDeepProp = /\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/,
          reIsPlainProp = /^\w*$/,
          rePropName = /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g;

      /**
       * Used to match `RegExp`
       * [syntax characters](http://ecma-international.org/ecma-262/7.0/#sec-patterns).
       */
      var reRegExpChar = /[\\^$.*+?()[\]{}|]/g,
          reHasRegExpChar = RegExp(reRegExpChar.source);

      /** Used to match leading whitespace. */
      var reTrimStart = /^\s+/;

      /** Used to match a single whitespace character. */
      var reWhitespace = /\s/;

      /** Used to match wrap detail comments. */
      var reWrapComment = /\{(?:\n\/\* \[wrapped with .+\] \*\/)?\n?/,
          reWrapDetails = /\{\n\/\* \[wrapped with (.+)\] \*/,
          reSplitDetails = /,? & /;

      /** Used to match words composed of alphanumeric characters. */
      var reAsciiWord = /[^\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]+/g;

      /**
       * Used to validate the `validate` option in `_.template` variable.
       *
       * Forbids characters which could potentially change the meaning of the function argument definition:
       * - "()," (modification of function parameters)
       * - "=" (default value)
       * - "[]{}" (destructuring of function parameters)
       * - "/" (beginning of a comment)
       * - whitespace
       */
      var reForbiddenIdentifierChars = /[()=,{}\[\]\/\s]/;

      /** Used to match backslashes in property paths. */
      var reEscapeChar = /\\(\\)?/g;

      /**
       * Used to match
       * [ES template delimiters](http://ecma-international.org/ecma-262/7.0/#sec-template-literal-lexical-components).
       */
      var reEsTemplate = /\$\{([^\\}]*(?:\\.[^\\}]*)*)\}/g;

      /** Used to match `RegExp` flags from their coerced string values. */
      var reFlags = /\w*$/;

      /** Used to detect bad signed hexadecimal string values. */
      var reIsBadHex = /^[-+]0x[0-9a-f]+$/i;

      /** Used to detect binary string values. */
      var reIsBinary = /^0b[01]+$/i;

      /** Used to detect host constructors (Safari). */
      var reIsHostCtor = /^\[object .+?Constructor\]$/;

      /** Used to detect octal string values. */
      var reIsOctal = /^0o[0-7]+$/i;

      /** Used to detect unsigned integer values. */
      var reIsUint = /^(?:0|[1-9]\d*)$/;

      /** Used to match Latin Unicode letters (excluding mathematical operators). */
      var reLatin = /[\xc0-\xd6\xd8-\xf6\xf8-\xff\u0100-\u017f]/g;

      /** Used to ensure capturing order of template delimiters. */
      var reNoMatch = /($^)/;

      /** Used to match unescaped characters in compiled string literals. */
      var reUnescapedString = /['\n\r\u2028\u2029\\]/g;

      /** Used to compose unicode character classes. */
      var rsAstralRange = '\\ud800-\\udfff',
          rsComboMarksRange = '\\u0300-\\u036f',
          reComboHalfMarksRange = '\\ufe20-\\ufe2f',
          rsComboSymbolsRange = '\\u20d0-\\u20ff',
          rsComboRange = rsComboMarksRange + reComboHalfMarksRange + rsComboSymbolsRange,
          rsDingbatRange = '\\u2700-\\u27bf',
          rsLowerRange = 'a-z\\xdf-\\xf6\\xf8-\\xff',
          rsMathOpRange = '\\xac\\xb1\\xd7\\xf7',
          rsNonCharRange = '\\x00-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\xbf',
          rsPunctuationRange = '\\u2000-\\u206f',
          rsSpaceRange = ' \\t\\x0b\\f\\xa0\\ufeff\\n\\r\\u2028\\u2029\\u1680\\u180e\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u202f\\u205f\\u3000',
          rsUpperRange = 'A-Z\\xc0-\\xd6\\xd8-\\xde',
          rsVarRange = '\\ufe0e\\ufe0f',
          rsBreakRange = rsMathOpRange + rsNonCharRange + rsPunctuationRange + rsSpaceRange;

      /** Used to compose unicode capture groups. */
      var rsApos = "['\u2019]",
          rsAstral = '[' + rsAstralRange + ']',
          rsBreak = '[' + rsBreakRange + ']',
          rsCombo = '[' + rsComboRange + ']',
          rsDigits = '\\d+',
          rsDingbat = '[' + rsDingbatRange + ']',
          rsLower = '[' + rsLowerRange + ']',
          rsMisc = '[^' + rsAstralRange + rsBreakRange + rsDigits + rsDingbatRange + rsLowerRange + rsUpperRange + ']',
          rsFitz = '\\ud83c[\\udffb-\\udfff]',
          rsModifier = '(?:' + rsCombo + '|' + rsFitz + ')',
          rsNonAstral = '[^' + rsAstralRange + ']',
          rsRegional = '(?:\\ud83c[\\udde6-\\uddff]){2}',
          rsSurrPair = '[\\ud800-\\udbff][\\udc00-\\udfff]',
          rsUpper = '[' + rsUpperRange + ']',
          rsZWJ = '\\u200d';

      /** Used to compose unicode regexes. */
      var rsMiscLower = '(?:' + rsLower + '|' + rsMisc + ')',
          rsMiscUpper = '(?:' + rsUpper + '|' + rsMisc + ')',
          rsOptContrLower = '(?:' + rsApos + '(?:d|ll|m|re|s|t|ve))?',
          rsOptContrUpper = '(?:' + rsApos + '(?:D|LL|M|RE|S|T|VE))?',
          reOptMod = rsModifier + '?',
          rsOptVar = '[' + rsVarRange + ']?',
          rsOptJoin = '(?:' + rsZWJ + '(?:' + [rsNonAstral, rsRegional, rsSurrPair].join('|') + ')' + rsOptVar + reOptMod + ')*',
          rsOrdLower = '\\d*(?:1st|2nd|3rd|(?![123])\\dth)(?=\\b|[A-Z_])',
          rsOrdUpper = '\\d*(?:1ST|2ND|3RD|(?![123])\\dTH)(?=\\b|[a-z_])',
          rsSeq = rsOptVar + reOptMod + rsOptJoin,
          rsEmoji = '(?:' + [rsDingbat, rsRegional, rsSurrPair].join('|') + ')' + rsSeq,
          rsSymbol = '(?:' + [rsNonAstral + rsCombo + '?', rsCombo, rsRegional, rsSurrPair, rsAstral].join('|') + ')';

      /** Used to match apostrophes. */
      var reApos = RegExp(rsApos, 'g');

      /**
       * Used to match [combining diacritical marks](https://en.wikipedia.org/wiki/Combining_Diacritical_Marks) and
       * [combining diacritical marks for symbols](https://en.wikipedia.org/wiki/Combining_Diacritical_Marks_for_Symbols).
       */
      var reComboMark = RegExp(rsCombo, 'g');

      /** Used to match [string symbols](https://mathiasbynens.be/notes/javascript-unicode). */
      var reUnicode = RegExp(rsFitz + '(?=' + rsFitz + ')|' + rsSymbol + rsSeq, 'g');

      /** Used to match complex or compound words. */
      var reUnicodeWord = RegExp([
        rsUpper + '?' + rsLower + '+' + rsOptContrLower + '(?=' + [rsBreak, rsUpper, '$'].join('|') + ')',
        rsMiscUpper + '+' + rsOptContrUpper + '(?=' + [rsBreak, rsUpper + rsMiscLower, '$'].join('|') + ')',
        rsUpper + '?' + rsMiscLower + '+' + rsOptContrLower,
        rsUpper + '+' + rsOptContrUpper,
        rsOrdUpper,
        rsOrdLower,
        rsDigits,
        rsEmoji
      ].join('|'), 'g');

      /** Used to detect strings with [zero-width joiners or code points from the astral planes](http://eev.ee/blog/2015/09/12/dark-corners-of-unicode/). */
      var reHasUnicode = RegExp('[' + rsZWJ + rsAstralRange  + rsComboRange + rsVarRange + ']');

      /** Used to detect strings that need a more robust regexp to match words. */
      var reHasUnicodeWord = /[a-z][A-Z]|[A-Z]{2}[a-z]|[0-9][a-zA-Z]|[a-zA-Z][0-9]|[^a-zA-Z0-9 ]/;

      /** Used to assign default `context` object properties. */
      var contextProps = [
        'Array', 'Buffer', 'DataView', 'Date', 'Error', 'Float32Array', 'Float64Array',
        'Function', 'Int8Array', 'Int16Array', 'Int32Array', 'Map', 'Math', 'Object',
        'Promise', 'RegExp', 'Set', 'String', 'Symbol', 'TypeError', 'Uint8Array',
        'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'WeakMap',
        '_', 'clearTimeout', 'isFinite', 'parseInt', 'setTimeout'
      ];

      /** Used to make template sourceURLs easier to identify. */
      var templateCounter = -1;

      /** Used to identify `toStringTag` values of typed arrays. */
      var typedArrayTags = {};
      typedArrayTags[float32Tag] = typedArrayTags[float64Tag] =
      typedArrayTags[int8Tag] = typedArrayTags[int16Tag] =
      typedArrayTags[int32Tag] = typedArrayTags[uint8Tag] =
      typedArrayTags[uint8ClampedTag] = typedArrayTags[uint16Tag] =
      typedArrayTags[uint32Tag] = true;
      typedArrayTags[argsTag] = typedArrayTags[arrayTag] =
      typedArrayTags[arrayBufferTag] = typedArrayTags[boolTag] =
      typedArrayTags[dataViewTag] = typedArrayTags[dateTag] =
      typedArrayTags[errorTag] = typedArrayTags[funcTag] =
      typedArrayTags[mapTag] = typedArrayTags[numberTag] =
      typedArrayTags[objectTag] = typedArrayTags[regexpTag] =
      typedArrayTags[setTag] = typedArrayTags[stringTag] =
      typedArrayTags[weakMapTag] = false;

      /** Used to identify `toStringTag` values supported by `_.clone`. */
      var cloneableTags = {};
      cloneableTags[argsTag] = cloneableTags[arrayTag] =
      cloneableTags[arrayBufferTag] = cloneableTags[dataViewTag] =
      cloneableTags[boolTag] = cloneableTags[dateTag] =
      cloneableTags[float32Tag] = cloneableTags[float64Tag] =
      cloneableTags[int8Tag] = cloneableTags[int16Tag] =
      cloneableTags[int32Tag] = cloneableTags[mapTag] =
      cloneableTags[numberTag] = cloneableTags[objectTag] =
      cloneableTags[regexpTag] = cloneableTags[setTag] =
      cloneableTags[stringTag] = cloneableTags[symbolTag] =
      cloneableTags[uint8Tag] = cloneableTags[uint8ClampedTag] =
      cloneableTags[uint16Tag] = cloneableTags[uint32Tag] = true;
      cloneableTags[errorTag] = cloneableTags[funcTag] =
      cloneableTags[weakMapTag] = false;

      /** Used to map Latin Unicode letters to basic Latin letters. */
      var deburredLetters = {
        // Latin-1 Supplement block.
        '\xc0': 'A',  '\xc1': 'A', '\xc2': 'A', '\xc3': 'A', '\xc4': 'A', '\xc5': 'A',
        '\xe0': 'a',  '\xe1': 'a', '\xe2': 'a', '\xe3': 'a', '\xe4': 'a', '\xe5': 'a',
        '\xc7': 'C',  '\xe7': 'c',
        '\xd0': 'D',  '\xf0': 'd',
        '\xc8': 'E',  '\xc9': 'E', '\xca': 'E', '\xcb': 'E',
        '\xe8': 'e',  '\xe9': 'e', '\xea': 'e', '\xeb': 'e',
        '\xcc': 'I',  '\xcd': 'I', '\xce': 'I', '\xcf': 'I',
        '\xec': 'i',  '\xed': 'i', '\xee': 'i', '\xef': 'i',
        '\xd1': 'N',  '\xf1': 'n',
        '\xd2': 'O',  '\xd3': 'O', '\xd4': 'O', '\xd5': 'O', '\xd6': 'O', '\xd8': 'O',
        '\xf2': 'o',  '\xf3': 'o', '\xf4': 'o', '\xf5': 'o', '\xf6': 'o', '\xf8': 'o',
        '\xd9': 'U',  '\xda': 'U', '\xdb': 'U', '\xdc': 'U',
        '\xf9': 'u',  '\xfa': 'u', '\xfb': 'u', '\xfc': 'u',
        '\xdd': 'Y',  '\xfd': 'y', '\xff': 'y',
        '\xc6': 'Ae', '\xe6': 'ae',
        '\xde': 'Th', '\xfe': 'th',
        '\xdf': 'ss',
        // Latin Extended-A block.
        '\u0100': 'A',  '\u0102': 'A', '\u0104': 'A',
        '\u0101': 'a',  '\u0103': 'a', '\u0105': 'a',
        '\u0106': 'C',  '\u0108': 'C', '\u010a': 'C', '\u010c': 'C',
        '\u0107': 'c',  '\u0109': 'c', '\u010b': 'c', '\u010d': 'c',
        '\u010e': 'D',  '\u0110': 'D', '\u010f': 'd', '\u0111': 'd',
        '\u0112': 'E',  '\u0114': 'E', '\u0116': 'E', '\u0118': 'E', '\u011a': 'E',
        '\u0113': 'e',  '\u0115': 'e', '\u0117': 'e', '\u0119': 'e', '\u011b': 'e',
        '\u011c': 'G',  '\u011e': 'G', '\u0120': 'G', '\u0122': 'G',
        '\u011d': 'g',  '\u011f': 'g', '\u0121': 'g', '\u0123': 'g',
        '\u0124': 'H',  '\u0126': 'H', '\u0125': 'h', '\u0127': 'h',
        '\u0128': 'I',  '\u012a': 'I', '\u012c': 'I', '\u012e': 'I', '\u0130': 'I',
        '\u0129': 'i',  '\u012b': 'i', '\u012d': 'i', '\u012f': 'i', '\u0131': 'i',
        '\u0134': 'J',  '\u0135': 'j',
        '\u0136': 'K',  '\u0137': 'k', '\u0138': 'k',
        '\u0139': 'L',  '\u013b': 'L', '\u013d': 'L', '\u013f': 'L', '\u0141': 'L',
        '\u013a': 'l',  '\u013c': 'l', '\u013e': 'l', '\u0140': 'l', '\u0142': 'l',
        '\u0143': 'N',  '\u0145': 'N', '\u0147': 'N', '\u014a': 'N',
        '\u0144': 'n',  '\u0146': 'n', '\u0148': 'n', '\u014b': 'n',
        '\u014c': 'O',  '\u014e': 'O', '\u0150': 'O',
        '\u014d': 'o',  '\u014f': 'o', '\u0151': 'o',
        '\u0154': 'R',  '\u0156': 'R', '\u0158': 'R',
        '\u0155': 'r',  '\u0157': 'r', '\u0159': 'r',
        '\u015a': 'S',  '\u015c': 'S', '\u015e': 'S', '\u0160': 'S',
        '\u015b': 's',  '\u015d': 's', '\u015f': 's', '\u0161': 's',
        '\u0162': 'T',  '\u0164': 'T', '\u0166': 'T',
        '\u0163': 't',  '\u0165': 't', '\u0167': 't',
        '\u0168': 'U',  '\u016a': 'U', '\u016c': 'U', '\u016e': 'U', '\u0170': 'U', '\u0172': 'U',
        '\u0169': 'u',  '\u016b': 'u', '\u016d': 'u', '\u016f': 'u', '\u0171': 'u', '\u0173': 'u',
        '\u0174': 'W',  '\u0175': 'w',
        '\u0176': 'Y',  '\u0177': 'y', '\u0178': 'Y',
        '\u0179': 'Z',  '\u017b': 'Z', '\u017d': 'Z',
        '\u017a': 'z',  '\u017c': 'z', '\u017e': 'z',
        '\u0132': 'IJ', '\u0133': 'ij',
        '\u0152': 'Oe', '\u0153': 'oe',
        '\u0149': "'n", '\u017f': 's'
      };

      /** Used to map characters to HTML entities. */
      var htmlEscapes = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      };

      /** Used to map HTML entities to characters. */
      var htmlUnescapes = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'"
      };

      /** Used to escape characters for inclusion in compiled string literals. */
      var stringEscapes = {
        '\\': '\\',
        "'": "'",
        '\n': 'n',
        '\r': 'r',
        '\u2028': 'u2028',
        '\u2029': 'u2029'
      };

      /** Built-in method references without a dependency on `root`. */
      var freeParseFloat = parseFloat,
          freeParseInt = parseInt;

      /** Detect free variable `global` from Node.js. */
      var freeGlobal = typeof commonjsGlobal == 'object' && commonjsGlobal && commonjsGlobal.Object === Object && commonjsGlobal;

      /** Detect free variable `self`. */
      var freeSelf = typeof self == 'object' && self && self.Object === Object && self;

      /** Used as a reference to the global object. */
      var root = freeGlobal || freeSelf || Function('return this')();

      /** Detect free variable `exports`. */
      var freeExports = exports && !exports.nodeType && exports;

      /** Detect free variable `module`. */
      var freeModule = freeExports && 'object' == 'object' && module && !module.nodeType && module;

      /** Detect the popular CommonJS extension `module.exports`. */
      var moduleExports = freeModule && freeModule.exports === freeExports;

      /** Detect free variable `process` from Node.js. */
      var freeProcess = moduleExports && freeGlobal.process;

      /** Used to access faster Node.js helpers. */
      var nodeUtil = (function() {
        try {
          // Use `util.types` for Node.js 10+.
          var types = freeModule && freeModule.require && freeModule.require('util').types;

          if (types) {
            return types;
          }

          // Legacy `process.binding('util')` for Node.js < 10.
          return freeProcess && freeProcess.binding && freeProcess.binding('util');
        } catch (e) {}
      }());

      /* Node.js helper references. */
      var nodeIsArrayBuffer = nodeUtil && nodeUtil.isArrayBuffer,
          nodeIsDate = nodeUtil && nodeUtil.isDate,
          nodeIsMap = nodeUtil && nodeUtil.isMap,
          nodeIsRegExp = nodeUtil && nodeUtil.isRegExp,
          nodeIsSet = nodeUtil && nodeUtil.isSet,
          nodeIsTypedArray = nodeUtil && nodeUtil.isTypedArray;

      /*--------------------------------------------------------------------------*/

      /**
       * A faster alternative to `Function#apply`, this function invokes `func`
       * with the `this` binding of `thisArg` and the arguments of `args`.
       *
       * @private
       * @param {Function} func The function to invoke.
       * @param {*} thisArg The `this` binding of `func`.
       * @param {Array} args The arguments to invoke `func` with.
       * @returns {*} Returns the result of `func`.
       */
      function apply(func, thisArg, args) {
        switch (args.length) {
          case 0: return func.call(thisArg);
          case 1: return func.call(thisArg, args[0]);
          case 2: return func.call(thisArg, args[0], args[1]);
          case 3: return func.call(thisArg, args[0], args[1], args[2]);
        }
        return func.apply(thisArg, args);
      }

      /**
       * A specialized version of `baseAggregator` for arrays.
       *
       * @private
       * @param {Array} [array] The array to iterate over.
       * @param {Function} setter The function to set `accumulator` values.
       * @param {Function} iteratee The iteratee to transform keys.
       * @param {Object} accumulator The initial aggregated object.
       * @returns {Function} Returns `accumulator`.
       */
      function arrayAggregator(array, setter, iteratee, accumulator) {
        var index = -1,
            length = array == null ? 0 : array.length;

        while (++index < length) {
          var value = array[index];
          setter(accumulator, value, iteratee(value), array);
        }
        return accumulator;
      }

      /**
       * A specialized version of `_.forEach` for arrays without support for
       * iteratee shorthands.
       *
       * @private
       * @param {Array} [array] The array to iterate over.
       * @param {Function} iteratee The function invoked per iteration.
       * @returns {Array} Returns `array`.
       */
      function arrayEach(array, iteratee) {
        var index = -1,
            length = array == null ? 0 : array.length;

        while (++index < length) {
          if (iteratee(array[index], index, array) === false) {
            break;
          }
        }
        return array;
      }

      /**
       * A specialized version of `_.forEachRight` for arrays without support for
       * iteratee shorthands.
       *
       * @private
       * @param {Array} [array] The array to iterate over.
       * @param {Function} iteratee The function invoked per iteration.
       * @returns {Array} Returns `array`.
       */
      function arrayEachRight(array, iteratee) {
        var length = array == null ? 0 : array.length;

        while (length--) {
          if (iteratee(array[length], length, array) === false) {
            break;
          }
        }
        return array;
      }

      /**
       * A specialized version of `_.every` for arrays without support for
       * iteratee shorthands.
       *
       * @private
       * @param {Array} [array] The array to iterate over.
       * @param {Function} predicate The function invoked per iteration.
       * @returns {boolean} Returns `true` if all elements pass the predicate check,
       *  else `false`.
       */
      function arrayEvery(array, predicate) {
        var index = -1,
            length = array == null ? 0 : array.length;

        while (++index < length) {
          if (!predicate(array[index], index, array)) {
            return false;
          }
        }
        return true;
      }

      /**
       * A specialized version of `_.filter` for arrays without support for
       * iteratee shorthands.
       *
       * @private
       * @param {Array} [array] The array to iterate over.
       * @param {Function} predicate The function invoked per iteration.
       * @returns {Array} Returns the new filtered array.
       */
      function arrayFilter(array, predicate) {
        var index = -1,
            length = array == null ? 0 : array.length,
            resIndex = 0,
            result = [];

        while (++index < length) {
          var value = array[index];
          if (predicate(value, index, array)) {
            result[resIndex++] = value;
          }
        }
        return result;
      }

      /**
       * A specialized version of `_.includes` for arrays without support for
       * specifying an index to search from.
       *
       * @private
       * @param {Array} [array] The array to inspect.
       * @param {*} target The value to search for.
       * @returns {boolean} Returns `true` if `target` is found, else `false`.
       */
      function arrayIncludes(array, value) {
        var length = array == null ? 0 : array.length;
        return !!length && baseIndexOf(array, value, 0) > -1;
      }

      /**
       * This function is like `arrayIncludes` except that it accepts a comparator.
       *
       * @private
       * @param {Array} [array] The array to inspect.
       * @param {*} target The value to search for.
       * @param {Function} comparator The comparator invoked per element.
       * @returns {boolean} Returns `true` if `target` is found, else `false`.
       */
      function arrayIncludesWith(array, value, comparator) {
        var index = -1,
            length = array == null ? 0 : array.length;

        while (++index < length) {
          if (comparator(value, array[index])) {
            return true;
          }
        }
        return false;
      }

      /**
       * A specialized version of `_.map` for arrays without support for iteratee
       * shorthands.
       *
       * @private
       * @param {Array} [array] The array to iterate over.
       * @param {Function} iteratee The function invoked per iteration.
       * @returns {Array} Returns the new mapped array.
       */
      function arrayMap(array, iteratee) {
        var index = -1,
            length = array == null ? 0 : array.length,
            result = Array(length);

        while (++index < length) {
          result[index] = iteratee(array[index], index, array);
        }
        return result;
      }

      /**
       * Appends the elements of `values` to `array`.
       *
       * @private
       * @param {Array} array The array to modify.
       * @param {Array} values The values to append.
       * @returns {Array} Returns `array`.
       */
      function arrayPush(array, values) {
        var index = -1,
            length = values.length,
            offset = array.length;

        while (++index < length) {
          array[offset + index] = values[index];
        }
        return array;
      }

      /**
       * A specialized version of `_.reduce` for arrays without support for
       * iteratee shorthands.
       *
       * @private
       * @param {Array} [array] The array to iterate over.
       * @param {Function} iteratee The function invoked per iteration.
       * @param {*} [accumulator] The initial value.
       * @param {boolean} [initAccum] Specify using the first element of `array` as
       *  the initial value.
       * @returns {*} Returns the accumulated value.
       */
      function arrayReduce(array, iteratee, accumulator, initAccum) {
        var index = -1,
            length = array == null ? 0 : array.length;

        if (initAccum && length) {
          accumulator = array[++index];
        }
        while (++index < length) {
          accumulator = iteratee(accumulator, array[index], index, array);
        }
        return accumulator;
      }

      /**
       * A specialized version of `_.reduceRight` for arrays without support for
       * iteratee shorthands.
       *
       * @private
       * @param {Array} [array] The array to iterate over.
       * @param {Function} iteratee The function invoked per iteration.
       * @param {*} [accumulator] The initial value.
       * @param {boolean} [initAccum] Specify using the last element of `array` as
       *  the initial value.
       * @returns {*} Returns the accumulated value.
       */
      function arrayReduceRight(array, iteratee, accumulator, initAccum) {
        var length = array == null ? 0 : array.length;
        if (initAccum && length) {
          accumulator = array[--length];
        }
        while (length--) {
          accumulator = iteratee(accumulator, array[length], length, array);
        }
        return accumulator;
      }

      /**
       * A specialized version of `_.some` for arrays without support for iteratee
       * shorthands.
       *
       * @private
       * @param {Array} [array] The array to iterate over.
       * @param {Function} predicate The function invoked per iteration.
       * @returns {boolean} Returns `true` if any element passes the predicate check,
       *  else `false`.
       */
      function arraySome(array, predicate) {
        var index = -1,
            length = array == null ? 0 : array.length;

        while (++index < length) {
          if (predicate(array[index], index, array)) {
            return true;
          }
        }
        return false;
      }

      /**
       * Gets the size of an ASCII `string`.
       *
       * @private
       * @param {string} string The string inspect.
       * @returns {number} Returns the string size.
       */
      var asciiSize = baseProperty('length');

      /**
       * Converts an ASCII `string` to an array.
       *
       * @private
       * @param {string} string The string to convert.
       * @returns {Array} Returns the converted array.
       */
      function asciiToArray(string) {
        return string.split('');
      }

      /**
       * Splits an ASCII `string` into an array of its words.
       *
       * @private
       * @param {string} The string to inspect.
       * @returns {Array} Returns the words of `string`.
       */
      function asciiWords(string) {
        return string.match(reAsciiWord) || [];
      }

      /**
       * The base implementation of methods like `_.findKey` and `_.findLastKey`,
       * without support for iteratee shorthands, which iterates over `collection`
       * using `eachFunc`.
       *
       * @private
       * @param {Array|Object} collection The collection to inspect.
       * @param {Function} predicate The function invoked per iteration.
       * @param {Function} eachFunc The function to iterate over `collection`.
       * @returns {*} Returns the found element or its key, else `undefined`.
       */
      function baseFindKey(collection, predicate, eachFunc) {
        var result;
        eachFunc(collection, function(value, key, collection) {
          if (predicate(value, key, collection)) {
            result = key;
            return false;
          }
        });
        return result;
      }

      /**
       * The base implementation of `_.findIndex` and `_.findLastIndex` without
       * support for iteratee shorthands.
       *
       * @private
       * @param {Array} array The array to inspect.
       * @param {Function} predicate The function invoked per iteration.
       * @param {number} fromIndex The index to search from.
       * @param {boolean} [fromRight] Specify iterating from right to left.
       * @returns {number} Returns the index of the matched value, else `-1`.
       */
      function baseFindIndex(array, predicate, fromIndex, fromRight) {
        var length = array.length,
            index = fromIndex + (fromRight ? 1 : -1);

        while ((fromRight ? index-- : ++index < length)) {
          if (predicate(array[index], index, array)) {
            return index;
          }
        }
        return -1;
      }

      /**
       * The base implementation of `_.indexOf` without `fromIndex` bounds checks.
       *
       * @private
       * @param {Array} array The array to inspect.
       * @param {*} value The value to search for.
       * @param {number} fromIndex The index to search from.
       * @returns {number} Returns the index of the matched value, else `-1`.
       */
      function baseIndexOf(array, value, fromIndex) {
        return value === value
          ? strictIndexOf(array, value, fromIndex)
          : baseFindIndex(array, baseIsNaN, fromIndex);
      }

      /**
       * This function is like `baseIndexOf` except that it accepts a comparator.
       *
       * @private
       * @param {Array} array The array to inspect.
       * @param {*} value The value to search for.
       * @param {number} fromIndex The index to search from.
       * @param {Function} comparator The comparator invoked per element.
       * @returns {number} Returns the index of the matched value, else `-1`.
       */
      function baseIndexOfWith(array, value, fromIndex, comparator) {
        var index = fromIndex - 1,
            length = array.length;

        while (++index < length) {
          if (comparator(array[index], value)) {
            return index;
          }
        }
        return -1;
      }

      /**
       * The base implementation of `_.isNaN` without support for number objects.
       *
       * @private
       * @param {*} value The value to check.
       * @returns {boolean} Returns `true` if `value` is `NaN`, else `false`.
       */
      function baseIsNaN(value) {
        return value !== value;
      }

      /**
       * The base implementation of `_.mean` and `_.meanBy` without support for
       * iteratee shorthands.
       *
       * @private
       * @param {Array} array The array to iterate over.
       * @param {Function} iteratee The function invoked per iteration.
       * @returns {number} Returns the mean.
       */
      function baseMean(array, iteratee) {
        var length = array == null ? 0 : array.length;
        return length ? (baseSum(array, iteratee) / length) : NAN;
      }

      /**
       * The base implementation of `_.property` without support for deep paths.
       *
       * @private
       * @param {string} key The key of the property to get.
       * @returns {Function} Returns the new accessor function.
       */
      function baseProperty(key) {
        return function(object) {
          return object == null ? undefined$1 : object[key];
        };
      }

      /**
       * The base implementation of `_.propertyOf` without support for deep paths.
       *
       * @private
       * @param {Object} object The object to query.
       * @returns {Function} Returns the new accessor function.
       */
      function basePropertyOf(object) {
        return function(key) {
          return object == null ? undefined$1 : object[key];
        };
      }

      /**
       * The base implementation of `_.reduce` and `_.reduceRight`, without support
       * for iteratee shorthands, which iterates over `collection` using `eachFunc`.
       *
       * @private
       * @param {Array|Object} collection The collection to iterate over.
       * @param {Function} iteratee The function invoked per iteration.
       * @param {*} accumulator The initial value.
       * @param {boolean} initAccum Specify using the first or last element of
       *  `collection` as the initial value.
       * @param {Function} eachFunc The function to iterate over `collection`.
       * @returns {*} Returns the accumulated value.
       */
      function baseReduce(collection, iteratee, accumulator, initAccum, eachFunc) {
        eachFunc(collection, function(value, index, collection) {
          accumulator = initAccum
            ? (initAccum = false, value)
            : iteratee(accumulator, value, index, collection);
        });
        return accumulator;
      }

      /**
       * The base implementation of `_.sortBy` which uses `comparer` to define the
       * sort order of `array` and replaces criteria objects with their corresponding
       * values.
       *
       * @private
       * @param {Array} array The array to sort.
       * @param {Function} comparer The function to define sort order.
       * @returns {Array} Returns `array`.
       */
      function baseSortBy(array, comparer) {
        var length = array.length;

        array.sort(comparer);
        while (length--) {
          array[length] = array[length].value;
        }
        return array;
      }

      /**
       * The base implementation of `_.sum` and `_.sumBy` without support for
       * iteratee shorthands.
       *
       * @private
       * @param {Array} array The array to iterate over.
       * @param {Function} iteratee The function invoked per iteration.
       * @returns {number} Returns the sum.
       */
      function baseSum(array, iteratee) {
        var result,
            index = -1,
            length = array.length;

        while (++index < length) {
          var current = iteratee(array[index]);
          if (current !== undefined$1) {
            result = result === undefined$1 ? current : (result + current);
          }
        }
        return result;
      }

      /**
       * The base implementation of `_.times` without support for iteratee shorthands
       * or max array length checks.
       *
       * @private
       * @param {number} n The number of times to invoke `iteratee`.
       * @param {Function} iteratee The function invoked per iteration.
       * @returns {Array} Returns the array of results.
       */
      function baseTimes(n, iteratee) {
        var index = -1,
            result = Array(n);

        while (++index < n) {
          result[index] = iteratee(index);
        }
        return result;
      }

      /**
       * The base implementation of `_.toPairs` and `_.toPairsIn` which creates an array
       * of key-value pairs for `object` corresponding to the property names of `props`.
       *
       * @private
       * @param {Object} object The object to query.
       * @param {Array} props The property names to get values for.
       * @returns {Object} Returns the key-value pairs.
       */
      function baseToPairs(object, props) {
        return arrayMap(props, function(key) {
          return [key, object[key]];
        });
      }

      /**
       * The base implementation of `_.trim`.
       *
       * @private
       * @param {string} string The string to trim.
       * @returns {string} Returns the trimmed string.
       */
      function baseTrim(string) {
        return string
          ? string.slice(0, trimmedEndIndex(string) + 1).replace(reTrimStart, '')
          : string;
      }

      /**
       * The base implementation of `_.unary` without support for storing metadata.
       *
       * @private
       * @param {Function} func The function to cap arguments for.
       * @returns {Function} Returns the new capped function.
       */
      function baseUnary(func) {
        return function(value) {
          return func(value);
        };
      }

      /**
       * The base implementation of `_.values` and `_.valuesIn` which creates an
       * array of `object` property values corresponding to the property names
       * of `props`.
       *
       * @private
       * @param {Object} object The object to query.
       * @param {Array} props The property names to get values for.
       * @returns {Object} Returns the array of property values.
       */
      function baseValues(object, props) {
        return arrayMap(props, function(key) {
          return object[key];
        });
      }

      /**
       * Checks if a `cache` value for `key` exists.
       *
       * @private
       * @param {Object} cache The cache to query.
       * @param {string} key The key of the entry to check.
       * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
       */
      function cacheHas(cache, key) {
        return cache.has(key);
      }

      /**
       * Used by `_.trim` and `_.trimStart` to get the index of the first string symbol
       * that is not found in the character symbols.
       *
       * @private
       * @param {Array} strSymbols The string symbols to inspect.
       * @param {Array} chrSymbols The character symbols to find.
       * @returns {number} Returns the index of the first unmatched string symbol.
       */
      function charsStartIndex(strSymbols, chrSymbols) {
        var index = -1,
            length = strSymbols.length;

        while (++index < length && baseIndexOf(chrSymbols, strSymbols[index], 0) > -1) {}
        return index;
      }

      /**
       * Used by `_.trim` and `_.trimEnd` to get the index of the last string symbol
       * that is not found in the character symbols.
       *
       * @private
       * @param {Array} strSymbols The string symbols to inspect.
       * @param {Array} chrSymbols The character symbols to find.
       * @returns {number} Returns the index of the last unmatched string symbol.
       */
      function charsEndIndex(strSymbols, chrSymbols) {
        var index = strSymbols.length;

        while (index-- && baseIndexOf(chrSymbols, strSymbols[index], 0) > -1) {}
        return index;
      }

      /**
       * Gets the number of `placeholder` occurrences in `array`.
       *
       * @private
       * @param {Array} array The array to inspect.
       * @param {*} placeholder The placeholder to search for.
       * @returns {number} Returns the placeholder count.
       */
      function countHolders(array, placeholder) {
        var length = array.length,
            result = 0;

        while (length--) {
          if (array[length] === placeholder) {
            ++result;
          }
        }
        return result;
      }

      /**
       * Used by `_.deburr` to convert Latin-1 Supplement and Latin Extended-A
       * letters to basic Latin letters.
       *
       * @private
       * @param {string} letter The matched letter to deburr.
       * @returns {string} Returns the deburred letter.
       */
      var deburrLetter = basePropertyOf(deburredLetters);

      /**
       * Used by `_.escape` to convert characters to HTML entities.
       *
       * @private
       * @param {string} chr The matched character to escape.
       * @returns {string} Returns the escaped character.
       */
      var escapeHtmlChar = basePropertyOf(htmlEscapes);

      /**
       * Used by `_.template` to escape characters for inclusion in compiled string literals.
       *
       * @private
       * @param {string} chr The matched character to escape.
       * @returns {string} Returns the escaped character.
       */
      function escapeStringChar(chr) {
        return '\\' + stringEscapes[chr];
      }

      /**
       * Gets the value at `key` of `object`.
       *
       * @private
       * @param {Object} [object] The object to query.
       * @param {string} key The key of the property to get.
       * @returns {*} Returns the property value.
       */
      function getValue(object, key) {
        return object == null ? undefined$1 : object[key];
      }

      /**
       * Checks if `string` contains Unicode symbols.
       *
       * @private
       * @param {string} string The string to inspect.
       * @returns {boolean} Returns `true` if a symbol is found, else `false`.
       */
      function hasUnicode(string) {
        return reHasUnicode.test(string);
      }

      /**
       * Checks if `string` contains a word composed of Unicode symbols.
       *
       * @private
       * @param {string} string The string to inspect.
       * @returns {boolean} Returns `true` if a word is found, else `false`.
       */
      function hasUnicodeWord(string) {
        return reHasUnicodeWord.test(string);
      }

      /**
       * Converts `iterator` to an array.
       *
       * @private
       * @param {Object} iterator The iterator to convert.
       * @returns {Array} Returns the converted array.
       */
      function iteratorToArray(iterator) {
        var data,
            result = [];

        while (!(data = iterator.next()).done) {
          result.push(data.value);
        }
        return result;
      }

      /**
       * Converts `map` to its key-value pairs.
       *
       * @private
       * @param {Object} map The map to convert.
       * @returns {Array} Returns the key-value pairs.
       */
      function mapToArray(map) {
        var index = -1,
            result = Array(map.size);

        map.forEach(function(value, key) {
          result[++index] = [key, value];
        });
        return result;
      }

      /**
       * Creates a unary function that invokes `func` with its argument transformed.
       *
       * @private
       * @param {Function} func The function to wrap.
       * @param {Function} transform The argument transform.
       * @returns {Function} Returns the new function.
       */
      function overArg(func, transform) {
        return function(arg) {
          return func(transform(arg));
        };
      }

      /**
       * Replaces all `placeholder` elements in `array` with an internal placeholder
       * and returns an array of their indexes.
       *
       * @private
       * @param {Array} array The array to modify.
       * @param {*} placeholder The placeholder to replace.
       * @returns {Array} Returns the new array of placeholder indexes.
       */
      function replaceHolders(array, placeholder) {
        var index = -1,
            length = array.length,
            resIndex = 0,
            result = [];

        while (++index < length) {
          var value = array[index];
          if (value === placeholder || value === PLACEHOLDER) {
            array[index] = PLACEHOLDER;
            result[resIndex++] = index;
          }
        }
        return result;
      }

      /**
       * Converts `set` to an array of its values.
       *
       * @private
       * @param {Object} set The set to convert.
       * @returns {Array} Returns the values.
       */
      function setToArray(set) {
        var index = -1,
            result = Array(set.size);

        set.forEach(function(value) {
          result[++index] = value;
        });
        return result;
      }

      /**
       * Converts `set` to its value-value pairs.
       *
       * @private
       * @param {Object} set The set to convert.
       * @returns {Array} Returns the value-value pairs.
       */
      function setToPairs(set) {
        var index = -1,
            result = Array(set.size);

        set.forEach(function(value) {
          result[++index] = [value, value];
        });
        return result;
      }

      /**
       * A specialized version of `_.indexOf` which performs strict equality
       * comparisons of values, i.e. `===`.
       *
       * @private
       * @param {Array} array The array to inspect.
       * @param {*} value The value to search for.
       * @param {number} fromIndex The index to search from.
       * @returns {number} Returns the index of the matched value, else `-1`.
       */
      function strictIndexOf(array, value, fromIndex) {
        var index = fromIndex - 1,
            length = array.length;

        while (++index < length) {
          if (array[index] === value) {
            return index;
          }
        }
        return -1;
      }

      /**
       * A specialized version of `_.lastIndexOf` which performs strict equality
       * comparisons of values, i.e. `===`.
       *
       * @private
       * @param {Array} array The array to inspect.
       * @param {*} value The value to search for.
       * @param {number} fromIndex The index to search from.
       * @returns {number} Returns the index of the matched value, else `-1`.
       */
      function strictLastIndexOf(array, value, fromIndex) {
        var index = fromIndex + 1;
        while (index--) {
          if (array[index] === value) {
            return index;
          }
        }
        return index;
      }

      /**
       * Gets the number of symbols in `string`.
       *
       * @private
       * @param {string} string The string to inspect.
       * @returns {number} Returns the string size.
       */
      function stringSize(string) {
        return hasUnicode(string)
          ? unicodeSize(string)
          : asciiSize(string);
      }

      /**
       * Converts `string` to an array.
       *
       * @private
       * @param {string} string The string to convert.
       * @returns {Array} Returns the converted array.
       */
      function stringToArray(string) {
        return hasUnicode(string)
          ? unicodeToArray(string)
          : asciiToArray(string);
      }

      /**
       * Used by `_.trim` and `_.trimEnd` to get the index of the last non-whitespace
       * character of `string`.
       *
       * @private
       * @param {string} string The string to inspect.
       * @returns {number} Returns the index of the last non-whitespace character.
       */
      function trimmedEndIndex(string) {
        var index = string.length;

        while (index-- && reWhitespace.test(string.charAt(index))) {}
        return index;
      }

      /**
       * Used by `_.unescape` to convert HTML entities to characters.
       *
       * @private
       * @param {string} chr The matched character to unescape.
       * @returns {string} Returns the unescaped character.
       */
      var unescapeHtmlChar = basePropertyOf(htmlUnescapes);

      /**
       * Gets the size of a Unicode `string`.
       *
       * @private
       * @param {string} string The string inspect.
       * @returns {number} Returns the string size.
       */
      function unicodeSize(string) {
        var result = reUnicode.lastIndex = 0;
        while (reUnicode.test(string)) {
          ++result;
        }
        return result;
      }

      /**
       * Converts a Unicode `string` to an array.
       *
       * @private
       * @param {string} string The string to convert.
       * @returns {Array} Returns the converted array.
       */
      function unicodeToArray(string) {
        return string.match(reUnicode) || [];
      }

      /**
       * Splits a Unicode `string` into an array of its words.
       *
       * @private
       * @param {string} The string to inspect.
       * @returns {Array} Returns the words of `string`.
       */
      function unicodeWords(string) {
        return string.match(reUnicodeWord) || [];
      }

      /*--------------------------------------------------------------------------*/

      /**
       * Create a new pristine `lodash` function using the `context` object.
       *
       * @static
       * @memberOf _
       * @since 1.1.0
       * @category Util
       * @param {Object} [context=root] The context object.
       * @returns {Function} Returns a new `lodash` function.
       * @example
       *
       * _.mixin({ 'foo': _.constant('foo') });
       *
       * var lodash = _.runInContext();
       * lodash.mixin({ 'bar': lodash.constant('bar') });
       *
       * _.isFunction(_.foo);
       * // => true
       * _.isFunction(_.bar);
       * // => false
       *
       * lodash.isFunction(lodash.foo);
       * // => false
       * lodash.isFunction(lodash.bar);
       * // => true
       *
       * // Create a suped-up `defer` in Node.js.
       * var defer = _.runInContext({ 'setTimeout': setImmediate }).defer;
       */
      var runInContext = (function runInContext(context) {
        context = context == null ? root : _.defaults(root.Object(), context, _.pick(root, contextProps));

        /** Built-in constructor references. */
        var Array = context.Array,
            Date = context.Date,
            Error = context.Error,
            Function = context.Function,
            Math = context.Math,
            Object = context.Object,
            RegExp = context.RegExp,
            String = context.String,
            TypeError = context.TypeError;

        /** Used for built-in method references. */
        var arrayProto = Array.prototype,
            funcProto = Function.prototype,
            objectProto = Object.prototype;

        /** Used to detect overreaching core-js shims. */
        var coreJsData = context['__core-js_shared__'];

        /** Used to resolve the decompiled source of functions. */
        var funcToString = funcProto.toString;

        /** Used to check objects for own properties. */
        var hasOwnProperty = objectProto.hasOwnProperty;

        /** Used to generate unique IDs. */
        var idCounter = 0;

        /** Used to detect methods masquerading as native. */
        var maskSrcKey = (function() {
          var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || '');
          return uid ? ('Symbol(src)_1.' + uid) : '';
        }());

        /**
         * Used to resolve the
         * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
         * of values.
         */
        var nativeObjectToString = objectProto.toString;

        /** Used to infer the `Object` constructor. */
        var objectCtorString = funcToString.call(Object);

        /** Used to restore the original `_` reference in `_.noConflict`. */
        var oldDash = root._;

        /** Used to detect if a method is native. */
        var reIsNative = RegExp('^' +
          funcToString.call(hasOwnProperty).replace(reRegExpChar, '\\$&')
          .replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, '$1.*?') + '$'
        );

        /** Built-in value references. */
        var Buffer = moduleExports ? context.Buffer : undefined$1,
            Symbol = context.Symbol,
            Uint8Array = context.Uint8Array,
            allocUnsafe = Buffer ? Buffer.allocUnsafe : undefined$1,
            getPrototype = overArg(Object.getPrototypeOf, Object),
            objectCreate = Object.create,
            propertyIsEnumerable = objectProto.propertyIsEnumerable,
            splice = arrayProto.splice,
            spreadableSymbol = Symbol ? Symbol.isConcatSpreadable : undefined$1,
            symIterator = Symbol ? Symbol.iterator : undefined$1,
            symToStringTag = Symbol ? Symbol.toStringTag : undefined$1;

        var defineProperty = (function() {
          try {
            var func = getNative(Object, 'defineProperty');
            func({}, '', {});
            return func;
          } catch (e) {}
        }());

        /** Mocked built-ins. */
        var ctxClearTimeout = context.clearTimeout !== root.clearTimeout && context.clearTimeout,
            ctxNow = Date && Date.now !== root.Date.now && Date.now,
            ctxSetTimeout = context.setTimeout !== root.setTimeout && context.setTimeout;

        /* Built-in method references for those with the same name as other `lodash` methods. */
        var nativeCeil = Math.ceil,
            nativeFloor = Math.floor,
            nativeGetSymbols = Object.getOwnPropertySymbols,
            nativeIsBuffer = Buffer ? Buffer.isBuffer : undefined$1,
            nativeIsFinite = context.isFinite,
            nativeJoin = arrayProto.join,
            nativeKeys = overArg(Object.keys, Object),
            nativeMax = Math.max,
            nativeMin = Math.min,
            nativeNow = Date.now,
            nativeParseInt = context.parseInt,
            nativeRandom = Math.random,
            nativeReverse = arrayProto.reverse;

        /* Built-in method references that are verified to be native. */
        var DataView = getNative(context, 'DataView'),
            Map = getNative(context, 'Map'),
            Promise = getNative(context, 'Promise'),
            Set = getNative(context, 'Set'),
            WeakMap = getNative(context, 'WeakMap'),
            nativeCreate = getNative(Object, 'create');

        /** Used to store function metadata. */
        var metaMap = WeakMap && new WeakMap;

        /** Used to lookup unminified function names. */
        var realNames = {};

        /** Used to detect maps, sets, and weakmaps. */
        var dataViewCtorString = toSource(DataView),
            mapCtorString = toSource(Map),
            promiseCtorString = toSource(Promise),
            setCtorString = toSource(Set),
            weakMapCtorString = toSource(WeakMap);

        /** Used to convert symbols to primitives and strings. */
        var symbolProto = Symbol ? Symbol.prototype : undefined$1,
            symbolValueOf = symbolProto ? symbolProto.valueOf : undefined$1,
            symbolToString = symbolProto ? symbolProto.toString : undefined$1;

        /*------------------------------------------------------------------------*/

        /**
         * Creates a `lodash` object which wraps `value` to enable implicit method
         * chain sequences. Methods that operate on and return arrays, collections,
         * and functions can be chained together. Methods that retrieve a single value
         * or may return a primitive value will automatically end the chain sequence
         * and return the unwrapped value. Otherwise, the value must be unwrapped
         * with `_#value`.
         *
         * Explicit chain sequences, which must be unwrapped with `_#value`, may be
         * enabled using `_.chain`.
         *
         * The execution of chained methods is lazy, that is, it's deferred until
         * `_#value` is implicitly or explicitly called.
         *
         * Lazy evaluation allows several methods to support shortcut fusion.
         * Shortcut fusion is an optimization to merge iteratee calls; this avoids
         * the creation of intermediate arrays and can greatly reduce the number of
         * iteratee executions. Sections of a chain sequence qualify for shortcut
         * fusion if the section is applied to an array and iteratees accept only
         * one argument. The heuristic for whether a section qualifies for shortcut
         * fusion is subject to change.
         *
         * Chaining is supported in custom builds as long as the `_#value` method is
         * directly or indirectly included in the build.
         *
         * In addition to lodash methods, wrappers have `Array` and `String` methods.
         *
         * The wrapper `Array` methods are:
         * `concat`, `join`, `pop`, `push`, `shift`, `sort`, `splice`, and `unshift`
         *
         * The wrapper `String` methods are:
         * `replace` and `split`
         *
         * The wrapper methods that support shortcut fusion are:
         * `at`, `compact`, `drop`, `dropRight`, `dropWhile`, `filter`, `find`,
         * `findLast`, `head`, `initial`, `last`, `map`, `reject`, `reverse`, `slice`,
         * `tail`, `take`, `takeRight`, `takeRightWhile`, `takeWhile`, and `toArray`
         *
         * The chainable wrapper methods are:
         * `after`, `ary`, `assign`, `assignIn`, `assignInWith`, `assignWith`, `at`,
         * `before`, `bind`, `bindAll`, `bindKey`, `castArray`, `chain`, `chunk`,
         * `commit`, `compact`, `concat`, `conforms`, `constant`, `countBy`, `create`,
         * `curry`, `debounce`, `defaults`, `defaultsDeep`, `defer`, `delay`,
         * `difference`, `differenceBy`, `differenceWith`, `drop`, `dropRight`,
         * `dropRightWhile`, `dropWhile`, `extend`, `extendWith`, `fill`, `filter`,
         * `flatMap`, `flatMapDeep`, `flatMapDepth`, `flatten`, `flattenDeep`,
         * `flattenDepth`, `flip`, `flow`, `flowRight`, `fromPairs`, `functions`,
         * `functionsIn`, `groupBy`, `initial`, `intersection`, `intersectionBy`,
         * `intersectionWith`, `invert`, `invertBy`, `invokeMap`, `iteratee`, `keyBy`,
         * `keys`, `keysIn`, `map`, `mapKeys`, `mapValues`, `matches`, `matchesProperty`,
         * `memoize`, `merge`, `mergeWith`, `method`, `methodOf`, `mixin`, `negate`,
         * `nthArg`, `omit`, `omitBy`, `once`, `orderBy`, `over`, `overArgs`,
         * `overEvery`, `overSome`, `partial`, `partialRight`, `partition`, `pick`,
         * `pickBy`, `plant`, `property`, `propertyOf`, `pull`, `pullAll`, `pullAllBy`,
         * `pullAllWith`, `pullAt`, `push`, `range`, `rangeRight`, `rearg`, `reject`,
         * `remove`, `rest`, `reverse`, `sampleSize`, `set`, `setWith`, `shuffle`,
         * `slice`, `sort`, `sortBy`, `splice`, `spread`, `tail`, `take`, `takeRight`,
         * `takeRightWhile`, `takeWhile`, `tap`, `throttle`, `thru`, `toArray`,
         * `toPairs`, `toPairsIn`, `toPath`, `toPlainObject`, `transform`, `unary`,
         * `union`, `unionBy`, `unionWith`, `uniq`, `uniqBy`, `uniqWith`, `unset`,
         * `unshift`, `unzip`, `unzipWith`, `update`, `updateWith`, `values`,
         * `valuesIn`, `without`, `wrap`, `xor`, `xorBy`, `xorWith`, `zip`,
         * `zipObject`, `zipObjectDeep`, and `zipWith`
         *
         * The wrapper methods that are **not** chainable by default are:
         * `add`, `attempt`, `camelCase`, `capitalize`, `ceil`, `clamp`, `clone`,
         * `cloneDeep`, `cloneDeepWith`, `cloneWith`, `conformsTo`, `deburr`,
         * `defaultTo`, `divide`, `each`, `eachRight`, `endsWith`, `eq`, `escape`,
         * `escapeRegExp`, `every`, `find`, `findIndex`, `findKey`, `findLast`,
         * `findLastIndex`, `findLastKey`, `first`, `floor`, `forEach`, `forEachRight`,
         * `forIn`, `forInRight`, `forOwn`, `forOwnRight`, `get`, `gt`, `gte`, `has`,
         * `hasIn`, `head`, `identity`, `includes`, `indexOf`, `inRange`, `invoke`,
         * `isArguments`, `isArray`, `isArrayBuffer`, `isArrayLike`, `isArrayLikeObject`,
         * `isBoolean`, `isBuffer`, `isDate`, `isElement`, `isEmpty`, `isEqual`,
         * `isEqualWith`, `isError`, `isFinite`, `isFunction`, `isInteger`, `isLength`,
         * `isMap`, `isMatch`, `isMatchWith`, `isNaN`, `isNative`, `isNil`, `isNull`,
         * `isNumber`, `isObject`, `isObjectLike`, `isPlainObject`, `isRegExp`,
         * `isSafeInteger`, `isSet`, `isString`, `isUndefined`, `isTypedArray`,
         * `isWeakMap`, `isWeakSet`, `join`, `kebabCase`, `last`, `lastIndexOf`,
         * `lowerCase`, `lowerFirst`, `lt`, `lte`, `max`, `maxBy`, `mean`, `meanBy`,
         * `min`, `minBy`, `multiply`, `noConflict`, `noop`, `now`, `nth`, `pad`,
         * `padEnd`, `padStart`, `parseInt`, `pop`, `random`, `reduce`, `reduceRight`,
         * `repeat`, `result`, `round`, `runInContext`, `sample`, `shift`, `size`,
         * `snakeCase`, `some`, `sortedIndex`, `sortedIndexBy`, `sortedLastIndex`,
         * `sortedLastIndexBy`, `startCase`, `startsWith`, `stubArray`, `stubFalse`,
         * `stubObject`, `stubString`, `stubTrue`, `subtract`, `sum`, `sumBy`,
         * `template`, `times`, `toFinite`, `toInteger`, `toJSON`, `toLength`,
         * `toLower`, `toNumber`, `toSafeInteger`, `toString`, `toUpper`, `trim`,
         * `trimEnd`, `trimStart`, `truncate`, `unescape`, `uniqueId`, `upperCase`,
         * `upperFirst`, `value`, and `words`
         *
         * @name _
         * @constructor
         * @category Seq
         * @param {*} value The value to wrap in a `lodash` instance.
         * @returns {Object} Returns the new `lodash` wrapper instance.
         * @example
         *
         * function square(n) {
         *   return n * n;
         * }
         *
         * var wrapped = _([1, 2, 3]);
         *
         * // Returns an unwrapped value.
         * wrapped.reduce(_.add);
         * // => 6
         *
         * // Returns a wrapped value.
         * var squares = wrapped.map(square);
         *
         * _.isArray(squares);
         * // => false
         *
         * _.isArray(squares.value());
         * // => true
         */
        function lodash(value) {
          if (isObjectLike(value) && !isArray(value) && !(value instanceof LazyWrapper)) {
            if (value instanceof LodashWrapper) {
              return value;
            }
            if (hasOwnProperty.call(value, '__wrapped__')) {
              return wrapperClone(value);
            }
          }
          return new LodashWrapper(value);
        }

        /**
         * The base implementation of `_.create` without support for assigning
         * properties to the created object.
         *
         * @private
         * @param {Object} proto The object to inherit from.
         * @returns {Object} Returns the new object.
         */
        var baseCreate = (function() {
          function object() {}
          return function(proto) {
            if (!isObject(proto)) {
              return {};
            }
            if (objectCreate) {
              return objectCreate(proto);
            }
            object.prototype = proto;
            var result = new object;
            object.prototype = undefined$1;
            return result;
          };
        }());

        /**
         * The function whose prototype chain sequence wrappers inherit from.
         *
         * @private
         */
        function baseLodash() {
          // No operation performed.
        }

        /**
         * The base constructor for creating `lodash` wrapper objects.
         *
         * @private
         * @param {*} value The value to wrap.
         * @param {boolean} [chainAll] Enable explicit method chain sequences.
         */
        function LodashWrapper(value, chainAll) {
          this.__wrapped__ = value;
          this.__actions__ = [];
          this.__chain__ = !!chainAll;
          this.__index__ = 0;
          this.__values__ = undefined$1;
        }

        /**
         * By default, the template delimiters used by lodash are like those in
         * embedded Ruby (ERB) as well as ES2015 template strings. Change the
         * following template settings to use alternative delimiters.
         *
         * @static
         * @memberOf _
         * @type {Object}
         */
        lodash.templateSettings = {

          /**
           * Used to detect `data` property values to be HTML-escaped.
           *
           * @memberOf _.templateSettings
           * @type {RegExp}
           */
          'escape': reEscape,

          /**
           * Used to detect code to be evaluated.
           *
           * @memberOf _.templateSettings
           * @type {RegExp}
           */
          'evaluate': reEvaluate,

          /**
           * Used to detect `data` property values to inject.
           *
           * @memberOf _.templateSettings
           * @type {RegExp}
           */
          'interpolate': reInterpolate,

          /**
           * Used to reference the data object in the template text.
           *
           * @memberOf _.templateSettings
           * @type {string}
           */
          'variable': '',

          /**
           * Used to import variables into the compiled template.
           *
           * @memberOf _.templateSettings
           * @type {Object}
           */
          'imports': {

            /**
             * A reference to the `lodash` function.
             *
             * @memberOf _.templateSettings.imports
             * @type {Function}
             */
            '_': lodash
          }
        };

        // Ensure wrappers are instances of `baseLodash`.
        lodash.prototype = baseLodash.prototype;
        lodash.prototype.constructor = lodash;

        LodashWrapper.prototype = baseCreate(baseLodash.prototype);
        LodashWrapper.prototype.constructor = LodashWrapper;

        /*------------------------------------------------------------------------*/

        /**
         * Creates a lazy wrapper object which wraps `value` to enable lazy evaluation.
         *
         * @private
         * @constructor
         * @param {*} value The value to wrap.
         */
        function LazyWrapper(value) {
          this.__wrapped__ = value;
          this.__actions__ = [];
          this.__dir__ = 1;
          this.__filtered__ = false;
          this.__iteratees__ = [];
          this.__takeCount__ = MAX_ARRAY_LENGTH;
          this.__views__ = [];
        }

        /**
         * Creates a clone of the lazy wrapper object.
         *
         * @private
         * @name clone
         * @memberOf LazyWrapper
         * @returns {Object} Returns the cloned `LazyWrapper` object.
         */
        function lazyClone() {
          var result = new LazyWrapper(this.__wrapped__);
          result.__actions__ = copyArray(this.__actions__);
          result.__dir__ = this.__dir__;
          result.__filtered__ = this.__filtered__;
          result.__iteratees__ = copyArray(this.__iteratees__);
          result.__takeCount__ = this.__takeCount__;
          result.__views__ = copyArray(this.__views__);
          return result;
        }

        /**
         * Reverses the direction of lazy iteration.
         *
         * @private
         * @name reverse
         * @memberOf LazyWrapper
         * @returns {Object} Returns the new reversed `LazyWrapper` object.
         */
        function lazyReverse() {
          if (this.__filtered__) {
            var result = new LazyWrapper(this);
            result.__dir__ = -1;
            result.__filtered__ = true;
          } else {
            result = this.clone();
            result.__dir__ *= -1;
          }
          return result;
        }

        /**
         * Extracts the unwrapped value from its lazy wrapper.
         *
         * @private
         * @name value
         * @memberOf LazyWrapper
         * @returns {*} Returns the unwrapped value.
         */
        function lazyValue() {
          var array = this.__wrapped__.value(),
              dir = this.__dir__,
              isArr = isArray(array),
              isRight = dir < 0,
              arrLength = isArr ? array.length : 0,
              view = getView(0, arrLength, this.__views__),
              start = view.start,
              end = view.end,
              length = end - start,
              index = isRight ? end : (start - 1),
              iteratees = this.__iteratees__,
              iterLength = iteratees.length,
              resIndex = 0,
              takeCount = nativeMin(length, this.__takeCount__);

          if (!isArr || (!isRight && arrLength == length && takeCount == length)) {
            return baseWrapperValue(array, this.__actions__);
          }
          var result = [];

          outer:
          while (length-- && resIndex < takeCount) {
            index += dir;

            var iterIndex = -1,
                value = array[index];

            while (++iterIndex < iterLength) {
              var data = iteratees[iterIndex],
                  iteratee = data.iteratee,
                  type = data.type,
                  computed = iteratee(value);

              if (type == LAZY_MAP_FLAG) {
                value = computed;
              } else if (!computed) {
                if (type == LAZY_FILTER_FLAG) {
                  continue outer;
                } else {
                  break outer;
                }
              }
            }
            result[resIndex++] = value;
          }
          return result;
        }

        // Ensure `LazyWrapper` is an instance of `baseLodash`.
        LazyWrapper.prototype = baseCreate(baseLodash.prototype);
        LazyWrapper.prototype.constructor = LazyWrapper;

        /*------------------------------------------------------------------------*/

        /**
         * Creates a hash object.
         *
         * @private
         * @constructor
         * @param {Array} [entries] The key-value pairs to cache.
         */
        function Hash(entries) {
          var index = -1,
              length = entries == null ? 0 : entries.length;

          this.clear();
          while (++index < length) {
            var entry = entries[index];
            this.set(entry[0], entry[1]);
          }
        }

        /**
         * Removes all key-value entries from the hash.
         *
         * @private
         * @name clear
         * @memberOf Hash
         */
        function hashClear() {
          this.__data__ = nativeCreate ? nativeCreate(null) : {};
          this.size = 0;
        }

        /**
         * Removes `key` and its value from the hash.
         *
         * @private
         * @name delete
         * @memberOf Hash
         * @param {Object} hash The hash to modify.
         * @param {string} key The key of the value to remove.
         * @returns {boolean} Returns `true` if the entry was removed, else `false`.
         */
        function hashDelete(key) {
          var result = this.has(key) && delete this.__data__[key];
          this.size -= result ? 1 : 0;
          return result;
        }

        /**
         * Gets the hash value for `key`.
         *
         * @private
         * @name get
         * @memberOf Hash
         * @param {string} key The key of the value to get.
         * @returns {*} Returns the entry value.
         */
        function hashGet(key) {
          var data = this.__data__;
          if (nativeCreate) {
            var result = data[key];
            return result === HASH_UNDEFINED ? undefined$1 : result;
          }
          return hasOwnProperty.call(data, key) ? data[key] : undefined$1;
        }

        /**
         * Checks if a hash value for `key` exists.
         *
         * @private
         * @name has
         * @memberOf Hash
         * @param {string} key The key of the entry to check.
         * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
         */
        function hashHas(key) {
          var data = this.__data__;
          return nativeCreate ? (data[key] !== undefined$1) : hasOwnProperty.call(data, key);
        }

        /**
         * Sets the hash `key` to `value`.
         *
         * @private
         * @name set
         * @memberOf Hash
         * @param {string} key The key of the value to set.
         * @param {*} value The value to set.
         * @returns {Object} Returns the hash instance.
         */
        function hashSet(key, value) {
          var data = this.__data__;
          this.size += this.has(key) ? 0 : 1;
          data[key] = (nativeCreate && value === undefined$1) ? HASH_UNDEFINED : value;
          return this;
        }

        // Add methods to `Hash`.
        Hash.prototype.clear = hashClear;
        Hash.prototype['delete'] = hashDelete;
        Hash.prototype.get = hashGet;
        Hash.prototype.has = hashHas;
        Hash.prototype.set = hashSet;

        /*------------------------------------------------------------------------*/

        /**
         * Creates an list cache object.
         *
         * @private
         * @constructor
         * @param {Array} [entries] The key-value pairs to cache.
         */
        function ListCache(entries) {
          var index = -1,
              length = entries == null ? 0 : entries.length;

          this.clear();
          while (++index < length) {
            var entry = entries[index];
            this.set(entry[0], entry[1]);
          }
        }

        /**
         * Removes all key-value entries from the list cache.
         *
         * @private
         * @name clear
         * @memberOf ListCache
         */
        function listCacheClear() {
          this.__data__ = [];
          this.size = 0;
        }

        /**
         * Removes `key` and its value from the list cache.
         *
         * @private
         * @name delete
         * @memberOf ListCache
         * @param {string} key The key of the value to remove.
         * @returns {boolean} Returns `true` if the entry was removed, else `false`.
         */
        function listCacheDelete(key) {
          var data = this.__data__,
              index = assocIndexOf(data, key);

          if (index < 0) {
            return false;
          }
          var lastIndex = data.length - 1;
          if (index == lastIndex) {
            data.pop();
          } else {
            splice.call(data, index, 1);
          }
          --this.size;
          return true;
        }

        /**
         * Gets the list cache value for `key`.
         *
         * @private
         * @name get
         * @memberOf ListCache
         * @param {string} key The key of the value to get.
         * @returns {*} Returns the entry value.
         */
        function listCacheGet(key) {
          var data = this.__data__,
              index = assocIndexOf(data, key);

          return index < 0 ? undefined$1 : data[index][1];
        }

        /**
         * Checks if a list cache value for `key` exists.
         *
         * @private
         * @name has
         * @memberOf ListCache
         * @param {string} key The key of the entry to check.
         * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
         */
        function listCacheHas(key) {
          return assocIndexOf(this.__data__, key) > -1;
        }

        /**
         * Sets the list cache `key` to `value`.
         *
         * @private
         * @name set
         * @memberOf ListCache
         * @param {string} key The key of the value to set.
         * @param {*} value The value to set.
         * @returns {Object} Returns the list cache instance.
         */
        function listCacheSet(key, value) {
          var data = this.__data__,
              index = assocIndexOf(data, key);

          if (index < 0) {
            ++this.size;
            data.push([key, value]);
          } else {
            data[index][1] = value;
          }
          return this;
        }

        // Add methods to `ListCache`.
        ListCache.prototype.clear = listCacheClear;
        ListCache.prototype['delete'] = listCacheDelete;
        ListCache.prototype.get = listCacheGet;
        ListCache.prototype.has = listCacheHas;
        ListCache.prototype.set = listCacheSet;

        /*------------------------------------------------------------------------*/

        /**
         * Creates a map cache object to store key-value pairs.
         *
         * @private
         * @constructor
         * @param {Array} [entries] The key-value pairs to cache.
         */
        function MapCache(entries) {
          var index = -1,
              length = entries == null ? 0 : entries.length;

          this.clear();
          while (++index < length) {
            var entry = entries[index];
            this.set(entry[0], entry[1]);
          }
        }

        /**
         * Removes all key-value entries from the map.
         *
         * @private
         * @name clear
         * @memberOf MapCache
         */
        function mapCacheClear() {
          this.size = 0;
          this.__data__ = {
            'hash': new Hash,
            'map': new (Map || ListCache),
            'string': new Hash
          };
        }

        /**
         * Removes `key` and its value from the map.
         *
         * @private
         * @name delete
         * @memberOf MapCache
         * @param {string} key The key of the value to remove.
         * @returns {boolean} Returns `true` if the entry was removed, else `false`.
         */
        function mapCacheDelete(key) {
          var result = getMapData(this, key)['delete'](key);
          this.size -= result ? 1 : 0;
          return result;
        }

        /**
         * Gets the map value for `key`.
         *
         * @private
         * @name get
         * @memberOf MapCache
         * @param {string} key The key of the value to get.
         * @returns {*} Returns the entry value.
         */
        function mapCacheGet(key) {
          return getMapData(this, key).get(key);
        }

        /**
         * Checks if a map value for `key` exists.
         *
         * @private
         * @name has
         * @memberOf MapCache
         * @param {string} key The key of the entry to check.
         * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
         */
        function mapCacheHas(key) {
          return getMapData(this, key).has(key);
        }

        /**
         * Sets the map `key` to `value`.
         *
         * @private
         * @name set
         * @memberOf MapCache
         * @param {string} key The key of the value to set.
         * @param {*} value The value to set.
         * @returns {Object} Returns the map cache instance.
         */
        function mapCacheSet(key, value) {
          var data = getMapData(this, key),
              size = data.size;

          data.set(key, value);
          this.size += data.size == size ? 0 : 1;
          return this;
        }

        // Add methods to `MapCache`.
        MapCache.prototype.clear = mapCacheClear;
        MapCache.prototype['delete'] = mapCacheDelete;
        MapCache.prototype.get = mapCacheGet;
        MapCache.prototype.has = mapCacheHas;
        MapCache.prototype.set = mapCacheSet;

        /*------------------------------------------------------------------------*/

        /**
         *
         * Creates an array cache object to store unique values.
         *
         * @private
         * @constructor
         * @param {Array} [values] The values to cache.
         */
        function SetCache(values) {
          var index = -1,
              length = values == null ? 0 : values.length;

          this.__data__ = new MapCache;
          while (++index < length) {
            this.add(values[index]);
          }
        }

        /**
         * Adds `value` to the array cache.
         *
         * @private
         * @name add
         * @memberOf SetCache
         * @alias push
         * @param {*} value The value to cache.
         * @returns {Object} Returns the cache instance.
         */
        function setCacheAdd(value) {
          this.__data__.set(value, HASH_UNDEFINED);
          return this;
        }

        /**
         * Checks if `value` is in the array cache.
         *
         * @private
         * @name has
         * @memberOf SetCache
         * @param {*} value The value to search for.
         * @returns {number} Returns `true` if `value` is found, else `false`.
         */
        function setCacheHas(value) {
          return this.__data__.has(value);
        }

        // Add methods to `SetCache`.
        SetCache.prototype.add = SetCache.prototype.push = setCacheAdd;
        SetCache.prototype.has = setCacheHas;

        /*------------------------------------------------------------------------*/

        /**
         * Creates a stack cache object to store key-value pairs.
         *
         * @private
         * @constructor
         * @param {Array} [entries] The key-value pairs to cache.
         */
        function Stack(entries) {
          var data = this.__data__ = new ListCache(entries);
          this.size = data.size;
        }

        /**
         * Removes all key-value entries from the stack.
         *
         * @private
         * @name clear
         * @memberOf Stack
         */
        function stackClear() {
          this.__data__ = new ListCache;
          this.size = 0;
        }

        /**
         * Removes `key` and its value from the stack.
         *
         * @private
         * @name delete
         * @memberOf Stack
         * @param {string} key The key of the value to remove.
         * @returns {boolean} Returns `true` if the entry was removed, else `false`.
         */
        function stackDelete(key) {
          var data = this.__data__,
              result = data['delete'](key);

          this.size = data.size;
          return result;
        }

        /**
         * Gets the stack value for `key`.
         *
         * @private
         * @name get
         * @memberOf Stack
         * @param {string} key The key of the value to get.
         * @returns {*} Returns the entry value.
         */
        function stackGet(key) {
          return this.__data__.get(key);
        }

        /**
         * Checks if a stack value for `key` exists.
         *
         * @private
         * @name has
         * @memberOf Stack
         * @param {string} key The key of the entry to check.
         * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
         */
        function stackHas(key) {
          return this.__data__.has(key);
        }

        /**
         * Sets the stack `key` to `value`.
         *
         * @private
         * @name set
         * @memberOf Stack
         * @param {string} key The key of the value to set.
         * @param {*} value The value to set.
         * @returns {Object} Returns the stack cache instance.
         */
        function stackSet(key, value) {
          var data = this.__data__;
          if (data instanceof ListCache) {
            var pairs = data.__data__;
            if (!Map || (pairs.length < LARGE_ARRAY_SIZE - 1)) {
              pairs.push([key, value]);
              this.size = ++data.size;
              return this;
            }
            data = this.__data__ = new MapCache(pairs);
          }
          data.set(key, value);
          this.size = data.size;
          return this;
        }

        // Add methods to `Stack`.
        Stack.prototype.clear = stackClear;
        Stack.prototype['delete'] = stackDelete;
        Stack.prototype.get = stackGet;
        Stack.prototype.has = stackHas;
        Stack.prototype.set = stackSet;

        /*------------------------------------------------------------------------*/

        /**
         * Creates an array of the enumerable property names of the array-like `value`.
         *
         * @private
         * @param {*} value The value to query.
         * @param {boolean} inherited Specify returning inherited property names.
         * @returns {Array} Returns the array of property names.
         */
        function arrayLikeKeys(value, inherited) {
          var isArr = isArray(value),
              isArg = !isArr && isArguments(value),
              isBuff = !isArr && !isArg && isBuffer(value),
              isType = !isArr && !isArg && !isBuff && isTypedArray(value),
              skipIndexes = isArr || isArg || isBuff || isType,
              result = skipIndexes ? baseTimes(value.length, String) : [],
              length = result.length;

          for (var key in value) {
            if ((inherited || hasOwnProperty.call(value, key)) &&
                !(skipIndexes && (
                   // Safari 9 has enumerable `arguments.length` in strict mode.
                   key == 'length' ||
                   // Node.js 0.10 has enumerable non-index properties on buffers.
                   (isBuff && (key == 'offset' || key == 'parent')) ||
                   // PhantomJS 2 has enumerable non-index properties on typed arrays.
                   (isType && (key == 'buffer' || key == 'byteLength' || key == 'byteOffset')) ||
                   // Skip index properties.
                   isIndex(key, length)
                ))) {
              result.push(key);
            }
          }
          return result;
        }

        /**
         * A specialized version of `_.sample` for arrays.
         *
         * @private
         * @param {Array} array The array to sample.
         * @returns {*} Returns the random element.
         */
        function arraySample(array) {
          var length = array.length;
          return length ? array[baseRandom(0, length - 1)] : undefined$1;
        }

        /**
         * A specialized version of `_.sampleSize` for arrays.
         *
         * @private
         * @param {Array} array The array to sample.
         * @param {number} n The number of elements to sample.
         * @returns {Array} Returns the random elements.
         */
        function arraySampleSize(array, n) {
          return shuffleSelf(copyArray(array), baseClamp(n, 0, array.length));
        }

        /**
         * A specialized version of `_.shuffle` for arrays.
         *
         * @private
         * @param {Array} array The array to shuffle.
         * @returns {Array} Returns the new shuffled array.
         */
        function arrayShuffle(array) {
          return shuffleSelf(copyArray(array));
        }

        /**
         * This function is like `assignValue` except that it doesn't assign
         * `undefined` values.
         *
         * @private
         * @param {Object} object The object to modify.
         * @param {string} key The key of the property to assign.
         * @param {*} value The value to assign.
         */
        function assignMergeValue(object, key, value) {
          if ((value !== undefined$1 && !eq(object[key], value)) ||
              (value === undefined$1 && !(key in object))) {
            baseAssignValue(object, key, value);
          }
        }

        /**
         * Assigns `value` to `key` of `object` if the existing value is not equivalent
         * using [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
         * for equality comparisons.
         *
         * @private
         * @param {Object} object The object to modify.
         * @param {string} key The key of the property to assign.
         * @param {*} value The value to assign.
         */
        function assignValue(object, key, value) {
          var objValue = object[key];
          if (!(hasOwnProperty.call(object, key) && eq(objValue, value)) ||
              (value === undefined$1 && !(key in object))) {
            baseAssignValue(object, key, value);
          }
        }

        /**
         * Gets the index at which the `key` is found in `array` of key-value pairs.
         *
         * @private
         * @param {Array} array The array to inspect.
         * @param {*} key The key to search for.
         * @returns {number} Returns the index of the matched value, else `-1`.
         */
        function assocIndexOf(array, key) {
          var length = array.length;
          while (length--) {
            if (eq(array[length][0], key)) {
              return length;
            }
          }
          return -1;
        }

        /**
         * Aggregates elements of `collection` on `accumulator` with keys transformed
         * by `iteratee` and values set by `setter`.
         *
         * @private
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} setter The function to set `accumulator` values.
         * @param {Function} iteratee The iteratee to transform keys.
         * @param {Object} accumulator The initial aggregated object.
         * @returns {Function} Returns `accumulator`.
         */
        function baseAggregator(collection, setter, iteratee, accumulator) {
          baseEach(collection, function(value, key, collection) {
            setter(accumulator, value, iteratee(value), collection);
          });
          return accumulator;
        }

        /**
         * The base implementation of `_.assign` without support for multiple sources
         * or `customizer` functions.
         *
         * @private
         * @param {Object} object The destination object.
         * @param {Object} source The source object.
         * @returns {Object} Returns `object`.
         */
        function baseAssign(object, source) {
          return object && copyObject(source, keys(source), object);
        }

        /**
         * The base implementation of `_.assignIn` without support for multiple sources
         * or `customizer` functions.
         *
         * @private
         * @param {Object} object The destination object.
         * @param {Object} source The source object.
         * @returns {Object} Returns `object`.
         */
        function baseAssignIn(object, source) {
          return object && copyObject(source, keysIn(source), object);
        }

        /**
         * The base implementation of `assignValue` and `assignMergeValue` without
         * value checks.
         *
         * @private
         * @param {Object} object The object to modify.
         * @param {string} key The key of the property to assign.
         * @param {*} value The value to assign.
         */
        function baseAssignValue(object, key, value) {
          if (key == '__proto__' && defineProperty) {
            defineProperty(object, key, {
              'configurable': true,
              'enumerable': true,
              'value': value,
              'writable': true
            });
          } else {
            object[key] = value;
          }
        }

        /**
         * The base implementation of `_.at` without support for individual paths.
         *
         * @private
         * @param {Object} object The object to iterate over.
         * @param {string[]} paths The property paths to pick.
         * @returns {Array} Returns the picked elements.
         */
        function baseAt(object, paths) {
          var index = -1,
              length = paths.length,
              result = Array(length),
              skip = object == null;

          while (++index < length) {
            result[index] = skip ? undefined$1 : get(object, paths[index]);
          }
          return result;
        }

        /**
         * The base implementation of `_.clamp` which doesn't coerce arguments.
         *
         * @private
         * @param {number} number The number to clamp.
         * @param {number} [lower] The lower bound.
         * @param {number} upper The upper bound.
         * @returns {number} Returns the clamped number.
         */
        function baseClamp(number, lower, upper) {
          if (number === number) {
            if (upper !== undefined$1) {
              number = number <= upper ? number : upper;
            }
            if (lower !== undefined$1) {
              number = number >= lower ? number : lower;
            }
          }
          return number;
        }

        /**
         * The base implementation of `_.clone` and `_.cloneDeep` which tracks
         * traversed objects.
         *
         * @private
         * @param {*} value The value to clone.
         * @param {boolean} bitmask The bitmask flags.
         *  1 - Deep clone
         *  2 - Flatten inherited properties
         *  4 - Clone symbols
         * @param {Function} [customizer] The function to customize cloning.
         * @param {string} [key] The key of `value`.
         * @param {Object} [object] The parent object of `value`.
         * @param {Object} [stack] Tracks traversed objects and their clone counterparts.
         * @returns {*} Returns the cloned value.
         */
        function baseClone(value, bitmask, customizer, key, object, stack) {
          var result,
              isDeep = bitmask & CLONE_DEEP_FLAG,
              isFlat = bitmask & CLONE_FLAT_FLAG,
              isFull = bitmask & CLONE_SYMBOLS_FLAG;

          if (customizer) {
            result = object ? customizer(value, key, object, stack) : customizer(value);
          }
          if (result !== undefined$1) {
            return result;
          }
          if (!isObject(value)) {
            return value;
          }
          var isArr = isArray(value);
          if (isArr) {
            result = initCloneArray(value);
            if (!isDeep) {
              return copyArray(value, result);
            }
          } else {
            var tag = getTag(value),
                isFunc = tag == funcTag || tag == genTag;

            if (isBuffer(value)) {
              return cloneBuffer(value, isDeep);
            }
            if (tag == objectTag || tag == argsTag || (isFunc && !object)) {
              result = (isFlat || isFunc) ? {} : initCloneObject(value);
              if (!isDeep) {
                return isFlat
                  ? copySymbolsIn(value, baseAssignIn(result, value))
                  : copySymbols(value, baseAssign(result, value));
              }
            } else {
              if (!cloneableTags[tag]) {
                return object ? value : {};
              }
              result = initCloneByTag(value, tag, isDeep);
            }
          }
          // Check for circular references and return its corresponding clone.
          stack || (stack = new Stack);
          var stacked = stack.get(value);
          if (stacked) {
            return stacked;
          }
          stack.set(value, result);

          if (isSet(value)) {
            value.forEach(function(subValue) {
              result.add(baseClone(subValue, bitmask, customizer, subValue, value, stack));
            });
          } else if (isMap(value)) {
            value.forEach(function(subValue, key) {
              result.set(key, baseClone(subValue, bitmask, customizer, key, value, stack));
            });
          }

          var keysFunc = isFull
            ? (isFlat ? getAllKeysIn : getAllKeys)
            : (isFlat ? keysIn : keys);

          var props = isArr ? undefined$1 : keysFunc(value);
          arrayEach(props || value, function(subValue, key) {
            if (props) {
              key = subValue;
              subValue = value[key];
            }
            // Recursively populate clone (susceptible to call stack limits).
            assignValue(result, key, baseClone(subValue, bitmask, customizer, key, value, stack));
          });
          return result;
        }

        /**
         * The base implementation of `_.conforms` which doesn't clone `source`.
         *
         * @private
         * @param {Object} source The object of property predicates to conform to.
         * @returns {Function} Returns the new spec function.
         */
        function baseConforms(source) {
          var props = keys(source);
          return function(object) {
            return baseConformsTo(object, source, props);
          };
        }

        /**
         * The base implementation of `_.conformsTo` which accepts `props` to check.
         *
         * @private
         * @param {Object} object The object to inspect.
         * @param {Object} source The object of property predicates to conform to.
         * @returns {boolean} Returns `true` if `object` conforms, else `false`.
         */
        function baseConformsTo(object, source, props) {
          var length = props.length;
          if (object == null) {
            return !length;
          }
          object = Object(object);
          while (length--) {
            var key = props[length],
                predicate = source[key],
                value = object[key];

            if ((value === undefined$1 && !(key in object)) || !predicate(value)) {
              return false;
            }
          }
          return true;
        }

        /**
         * The base implementation of `_.delay` and `_.defer` which accepts `args`
         * to provide to `func`.
         *
         * @private
         * @param {Function} func The function to delay.
         * @param {number} wait The number of milliseconds to delay invocation.
         * @param {Array} args The arguments to provide to `func`.
         * @returns {number|Object} Returns the timer id or timeout object.
         */
        function baseDelay(func, wait, args) {
          if (typeof func != 'function') {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          return setTimeout(function() { func.apply(undefined$1, args); }, wait);
        }

        /**
         * The base implementation of methods like `_.difference` without support
         * for excluding multiple arrays or iteratee shorthands.
         *
         * @private
         * @param {Array} array The array to inspect.
         * @param {Array} values The values to exclude.
         * @param {Function} [iteratee] The iteratee invoked per element.
         * @param {Function} [comparator] The comparator invoked per element.
         * @returns {Array} Returns the new array of filtered values.
         */
        function baseDifference(array, values, iteratee, comparator) {
          var index = -1,
              includes = arrayIncludes,
              isCommon = true,
              length = array.length,
              result = [],
              valuesLength = values.length;

          if (!length) {
            return result;
          }
          if (iteratee) {
            values = arrayMap(values, baseUnary(iteratee));
          }
          if (comparator) {
            includes = arrayIncludesWith;
            isCommon = false;
          }
          else if (values.length >= LARGE_ARRAY_SIZE) {
            includes = cacheHas;
            isCommon = false;
            values = new SetCache(values);
          }
          outer:
          while (++index < length) {
            var value = array[index],
                computed = iteratee == null ? value : iteratee(value);

            value = (comparator || value !== 0) ? value : 0;
            if (isCommon && computed === computed) {
              var valuesIndex = valuesLength;
              while (valuesIndex--) {
                if (values[valuesIndex] === computed) {
                  continue outer;
                }
              }
              result.push(value);
            }
            else if (!includes(values, computed, comparator)) {
              result.push(value);
            }
          }
          return result;
        }

        /**
         * The base implementation of `_.forEach` without support for iteratee shorthands.
         *
         * @private
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} iteratee The function invoked per iteration.
         * @returns {Array|Object} Returns `collection`.
         */
        var baseEach = createBaseEach(baseForOwn);

        /**
         * The base implementation of `_.forEachRight` without support for iteratee shorthands.
         *
         * @private
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} iteratee The function invoked per iteration.
         * @returns {Array|Object} Returns `collection`.
         */
        var baseEachRight = createBaseEach(baseForOwnRight, true);

        /**
         * The base implementation of `_.every` without support for iteratee shorthands.
         *
         * @private
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} predicate The function invoked per iteration.
         * @returns {boolean} Returns `true` if all elements pass the predicate check,
         *  else `false`
         */
        function baseEvery(collection, predicate) {
          var result = true;
          baseEach(collection, function(value, index, collection) {
            result = !!predicate(value, index, collection);
            return result;
          });
          return result;
        }

        /**
         * The base implementation of methods like `_.max` and `_.min` which accepts a
         * `comparator` to determine the extremum value.
         *
         * @private
         * @param {Array} array The array to iterate over.
         * @param {Function} iteratee The iteratee invoked per iteration.
         * @param {Function} comparator The comparator used to compare values.
         * @returns {*} Returns the extremum value.
         */
        function baseExtremum(array, iteratee, comparator) {
          var index = -1,
              length = array.length;

          while (++index < length) {
            var value = array[index],
                current = iteratee(value);

            if (current != null && (computed === undefined$1
                  ? (current === current && !isSymbol(current))
                  : comparator(current, computed)
                )) {
              var computed = current,
                  result = value;
            }
          }
          return result;
        }

        /**
         * The base implementation of `_.fill` without an iteratee call guard.
         *
         * @private
         * @param {Array} array The array to fill.
         * @param {*} value The value to fill `array` with.
         * @param {number} [start=0] The start position.
         * @param {number} [end=array.length] The end position.
         * @returns {Array} Returns `array`.
         */
        function baseFill(array, value, start, end) {
          var length = array.length;

          start = toInteger(start);
          if (start < 0) {
            start = -start > length ? 0 : (length + start);
          }
          end = (end === undefined$1 || end > length) ? length : toInteger(end);
          if (end < 0) {
            end += length;
          }
          end = start > end ? 0 : toLength(end);
          while (start < end) {
            array[start++] = value;
          }
          return array;
        }

        /**
         * The base implementation of `_.filter` without support for iteratee shorthands.
         *
         * @private
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} predicate The function invoked per iteration.
         * @returns {Array} Returns the new filtered array.
         */
        function baseFilter(collection, predicate) {
          var result = [];
          baseEach(collection, function(value, index, collection) {
            if (predicate(value, index, collection)) {
              result.push(value);
            }
          });
          return result;
        }

        /**
         * The base implementation of `_.flatten` with support for restricting flattening.
         *
         * @private
         * @param {Array} array The array to flatten.
         * @param {number} depth The maximum recursion depth.
         * @param {boolean} [predicate=isFlattenable] The function invoked per iteration.
         * @param {boolean} [isStrict] Restrict to values that pass `predicate` checks.
         * @param {Array} [result=[]] The initial result value.
         * @returns {Array} Returns the new flattened array.
         */
        function baseFlatten(array, depth, predicate, isStrict, result) {
          var index = -1,
              length = array.length;

          predicate || (predicate = isFlattenable);
          result || (result = []);

          while (++index < length) {
            var value = array[index];
            if (depth > 0 && predicate(value)) {
              if (depth > 1) {
                // Recursively flatten arrays (susceptible to call stack limits).
                baseFlatten(value, depth - 1, predicate, isStrict, result);
              } else {
                arrayPush(result, value);
              }
            } else if (!isStrict) {
              result[result.length] = value;
            }
          }
          return result;
        }

        /**
         * The base implementation of `baseForOwn` which iterates over `object`
         * properties returned by `keysFunc` and invokes `iteratee` for each property.
         * Iteratee functions may exit iteration early by explicitly returning `false`.
         *
         * @private
         * @param {Object} object The object to iterate over.
         * @param {Function} iteratee The function invoked per iteration.
         * @param {Function} keysFunc The function to get the keys of `object`.
         * @returns {Object} Returns `object`.
         */
        var baseFor = createBaseFor();

        /**
         * This function is like `baseFor` except that it iterates over properties
         * in the opposite order.
         *
         * @private
         * @param {Object} object The object to iterate over.
         * @param {Function} iteratee The function invoked per iteration.
         * @param {Function} keysFunc The function to get the keys of `object`.
         * @returns {Object} Returns `object`.
         */
        var baseForRight = createBaseFor(true);

        /**
         * The base implementation of `_.forOwn` without support for iteratee shorthands.
         *
         * @private
         * @param {Object} object The object to iterate over.
         * @param {Function} iteratee The function invoked per iteration.
         * @returns {Object} Returns `object`.
         */
        function baseForOwn(object, iteratee) {
          return object && baseFor(object, iteratee, keys);
        }

        /**
         * The base implementation of `_.forOwnRight` without support for iteratee shorthands.
         *
         * @private
         * @param {Object} object The object to iterate over.
         * @param {Function} iteratee The function invoked per iteration.
         * @returns {Object} Returns `object`.
         */
        function baseForOwnRight(object, iteratee) {
          return object && baseForRight(object, iteratee, keys);
        }

        /**
         * The base implementation of `_.functions` which creates an array of
         * `object` function property names filtered from `props`.
         *
         * @private
         * @param {Object} object The object to inspect.
         * @param {Array} props The property names to filter.
         * @returns {Array} Returns the function names.
         */
        function baseFunctions(object, props) {
          return arrayFilter(props, function(key) {
            return isFunction(object[key]);
          });
        }

        /**
         * The base implementation of `_.get` without support for default values.
         *
         * @private
         * @param {Object} object The object to query.
         * @param {Array|string} path The path of the property to get.
         * @returns {*} Returns the resolved value.
         */
        function baseGet(object, path) {
          path = castPath(path, object);

          var index = 0,
              length = path.length;

          while (object != null && index < length) {
            object = object[toKey(path[index++])];
          }
          return (index && index == length) ? object : undefined$1;
        }

        /**
         * The base implementation of `getAllKeys` and `getAllKeysIn` which uses
         * `keysFunc` and `symbolsFunc` to get the enumerable property names and
         * symbols of `object`.
         *
         * @private
         * @param {Object} object The object to query.
         * @param {Function} keysFunc The function to get the keys of `object`.
         * @param {Function} symbolsFunc The function to get the symbols of `object`.
         * @returns {Array} Returns the array of property names and symbols.
         */
        function baseGetAllKeys(object, keysFunc, symbolsFunc) {
          var result = keysFunc(object);
          return isArray(object) ? result : arrayPush(result, symbolsFunc(object));
        }

        /**
         * The base implementation of `getTag` without fallbacks for buggy environments.
         *
         * @private
         * @param {*} value The value to query.
         * @returns {string} Returns the `toStringTag`.
         */
        function baseGetTag(value) {
          if (value == null) {
            return value === undefined$1 ? undefinedTag : nullTag;
          }
          return (symToStringTag && symToStringTag in Object(value))
            ? getRawTag(value)
            : objectToString(value);
        }

        /**
         * The base implementation of `_.gt` which doesn't coerce arguments.
         *
         * @private
         * @param {*} value The value to compare.
         * @param {*} other The other value to compare.
         * @returns {boolean} Returns `true` if `value` is greater than `other`,
         *  else `false`.
         */
        function baseGt(value, other) {
          return value > other;
        }

        /**
         * The base implementation of `_.has` without support for deep paths.
         *
         * @private
         * @param {Object} [object] The object to query.
         * @param {Array|string} key The key to check.
         * @returns {boolean} Returns `true` if `key` exists, else `false`.
         */
        function baseHas(object, key) {
          return object != null && hasOwnProperty.call(object, key);
        }

        /**
         * The base implementation of `_.hasIn` without support for deep paths.
         *
         * @private
         * @param {Object} [object] The object to query.
         * @param {Array|string} key The key to check.
         * @returns {boolean} Returns `true` if `key` exists, else `false`.
         */
        function baseHasIn(object, key) {
          return object != null && key in Object(object);
        }

        /**
         * The base implementation of `_.inRange` which doesn't coerce arguments.
         *
         * @private
         * @param {number} number The number to check.
         * @param {number} start The start of the range.
         * @param {number} end The end of the range.
         * @returns {boolean} Returns `true` if `number` is in the range, else `false`.
         */
        function baseInRange(number, start, end) {
          return number >= nativeMin(start, end) && number < nativeMax(start, end);
        }

        /**
         * The base implementation of methods like `_.intersection`, without support
         * for iteratee shorthands, that accepts an array of arrays to inspect.
         *
         * @private
         * @param {Array} arrays The arrays to inspect.
         * @param {Function} [iteratee] The iteratee invoked per element.
         * @param {Function} [comparator] The comparator invoked per element.
         * @returns {Array} Returns the new array of shared values.
         */
        function baseIntersection(arrays, iteratee, comparator) {
          var includes = comparator ? arrayIncludesWith : arrayIncludes,
              length = arrays[0].length,
              othLength = arrays.length,
              othIndex = othLength,
              caches = Array(othLength),
              maxLength = Infinity,
              result = [];

          while (othIndex--) {
            var array = arrays[othIndex];
            if (othIndex && iteratee) {
              array = arrayMap(array, baseUnary(iteratee));
            }
            maxLength = nativeMin(array.length, maxLength);
            caches[othIndex] = !comparator && (iteratee || (length >= 120 && array.length >= 120))
              ? new SetCache(othIndex && array)
              : undefined$1;
          }
          array = arrays[0];

          var index = -1,
              seen = caches[0];

          outer:
          while (++index < length && result.length < maxLength) {
            var value = array[index],
                computed = iteratee ? iteratee(value) : value;

            value = (comparator || value !== 0) ? value : 0;
            if (!(seen
                  ? cacheHas(seen, computed)
                  : includes(result, computed, comparator)
                )) {
              othIndex = othLength;
              while (--othIndex) {
                var cache = caches[othIndex];
                if (!(cache
                      ? cacheHas(cache, computed)
                      : includes(arrays[othIndex], computed, comparator))
                    ) {
                  continue outer;
                }
              }
              if (seen) {
                seen.push(computed);
              }
              result.push(value);
            }
          }
          return result;
        }

        /**
         * The base implementation of `_.invert` and `_.invertBy` which inverts
         * `object` with values transformed by `iteratee` and set by `setter`.
         *
         * @private
         * @param {Object} object The object to iterate over.
         * @param {Function} setter The function to set `accumulator` values.
         * @param {Function} iteratee The iteratee to transform values.
         * @param {Object} accumulator The initial inverted object.
         * @returns {Function} Returns `accumulator`.
         */
        function baseInverter(object, setter, iteratee, accumulator) {
          baseForOwn(object, function(value, key, object) {
            setter(accumulator, iteratee(value), key, object);
          });
          return accumulator;
        }

        /**
         * The base implementation of `_.invoke` without support for individual
         * method arguments.
         *
         * @private
         * @param {Object} object The object to query.
         * @param {Array|string} path The path of the method to invoke.
         * @param {Array} args The arguments to invoke the method with.
         * @returns {*} Returns the result of the invoked method.
         */
        function baseInvoke(object, path, args) {
          path = castPath(path, object);
          object = parent(object, path);
          var func = object == null ? object : object[toKey(last(path))];
          return func == null ? undefined$1 : apply(func, object, args);
        }

        /**
         * The base implementation of `_.isArguments`.
         *
         * @private
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is an `arguments` object,
         */
        function baseIsArguments(value) {
          return isObjectLike(value) && baseGetTag(value) == argsTag;
        }

        /**
         * The base implementation of `_.isArrayBuffer` without Node.js optimizations.
         *
         * @private
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is an array buffer, else `false`.
         */
        function baseIsArrayBuffer(value) {
          return isObjectLike(value) && baseGetTag(value) == arrayBufferTag;
        }

        /**
         * The base implementation of `_.isDate` without Node.js optimizations.
         *
         * @private
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a date object, else `false`.
         */
        function baseIsDate(value) {
          return isObjectLike(value) && baseGetTag(value) == dateTag;
        }

        /**
         * The base implementation of `_.isEqual` which supports partial comparisons
         * and tracks traversed objects.
         *
         * @private
         * @param {*} value The value to compare.
         * @param {*} other The other value to compare.
         * @param {boolean} bitmask The bitmask flags.
         *  1 - Unordered comparison
         *  2 - Partial comparison
         * @param {Function} [customizer] The function to customize comparisons.
         * @param {Object} [stack] Tracks traversed `value` and `other` objects.
         * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
         */
        function baseIsEqual(value, other, bitmask, customizer, stack) {
          if (value === other) {
            return true;
          }
          if (value == null || other == null || (!isObjectLike(value) && !isObjectLike(other))) {
            return value !== value && other !== other;
          }
          return baseIsEqualDeep(value, other, bitmask, customizer, baseIsEqual, stack);
        }

        /**
         * A specialized version of `baseIsEqual` for arrays and objects which performs
         * deep comparisons and tracks traversed objects enabling objects with circular
         * references to be compared.
         *
         * @private
         * @param {Object} object The object to compare.
         * @param {Object} other The other object to compare.
         * @param {number} bitmask The bitmask flags. See `baseIsEqual` for more details.
         * @param {Function} customizer The function to customize comparisons.
         * @param {Function} equalFunc The function to determine equivalents of values.
         * @param {Object} [stack] Tracks traversed `object` and `other` objects.
         * @returns {boolean} Returns `true` if the objects are equivalent, else `false`.
         */
        function baseIsEqualDeep(object, other, bitmask, customizer, equalFunc, stack) {
          var objIsArr = isArray(object),
              othIsArr = isArray(other),
              objTag = objIsArr ? arrayTag : getTag(object),
              othTag = othIsArr ? arrayTag : getTag(other);

          objTag = objTag == argsTag ? objectTag : objTag;
          othTag = othTag == argsTag ? objectTag : othTag;

          var objIsObj = objTag == objectTag,
              othIsObj = othTag == objectTag,
              isSameTag = objTag == othTag;

          if (isSameTag && isBuffer(object)) {
            if (!isBuffer(other)) {
              return false;
            }
            objIsArr = true;
            objIsObj = false;
          }
          if (isSameTag && !objIsObj) {
            stack || (stack = new Stack);
            return (objIsArr || isTypedArray(object))
              ? equalArrays(object, other, bitmask, customizer, equalFunc, stack)
              : equalByTag(object, other, objTag, bitmask, customizer, equalFunc, stack);
          }
          if (!(bitmask & COMPARE_PARTIAL_FLAG)) {
            var objIsWrapped = objIsObj && hasOwnProperty.call(object, '__wrapped__'),
                othIsWrapped = othIsObj && hasOwnProperty.call(other, '__wrapped__');

            if (objIsWrapped || othIsWrapped) {
              var objUnwrapped = objIsWrapped ? object.value() : object,
                  othUnwrapped = othIsWrapped ? other.value() : other;

              stack || (stack = new Stack);
              return equalFunc(objUnwrapped, othUnwrapped, bitmask, customizer, stack);
            }
          }
          if (!isSameTag) {
            return false;
          }
          stack || (stack = new Stack);
          return equalObjects(object, other, bitmask, customizer, equalFunc, stack);
        }

        /**
         * The base implementation of `_.isMap` without Node.js optimizations.
         *
         * @private
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a map, else `false`.
         */
        function baseIsMap(value) {
          return isObjectLike(value) && getTag(value) == mapTag;
        }

        /**
         * The base implementation of `_.isMatch` without support for iteratee shorthands.
         *
         * @private
         * @param {Object} object The object to inspect.
         * @param {Object} source The object of property values to match.
         * @param {Array} matchData The property names, values, and compare flags to match.
         * @param {Function} [customizer] The function to customize comparisons.
         * @returns {boolean} Returns `true` if `object` is a match, else `false`.
         */
        function baseIsMatch(object, source, matchData, customizer) {
          var index = matchData.length,
              length = index,
              noCustomizer = !customizer;

          if (object == null) {
            return !length;
          }
          object = Object(object);
          while (index--) {
            var data = matchData[index];
            if ((noCustomizer && data[2])
                  ? data[1] !== object[data[0]]
                  : !(data[0] in object)
                ) {
              return false;
            }
          }
          while (++index < length) {
            data = matchData[index];
            var key = data[0],
                objValue = object[key],
                srcValue = data[1];

            if (noCustomizer && data[2]) {
              if (objValue === undefined$1 && !(key in object)) {
                return false;
              }
            } else {
              var stack = new Stack;
              if (customizer) {
                var result = customizer(objValue, srcValue, key, object, source, stack);
              }
              if (!(result === undefined$1
                    ? baseIsEqual(srcValue, objValue, COMPARE_PARTIAL_FLAG | COMPARE_UNORDERED_FLAG, customizer, stack)
                    : result
                  )) {
                return false;
              }
            }
          }
          return true;
        }

        /**
         * The base implementation of `_.isNative` without bad shim checks.
         *
         * @private
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a native function,
         *  else `false`.
         */
        function baseIsNative(value) {
          if (!isObject(value) || isMasked(value)) {
            return false;
          }
          var pattern = isFunction(value) ? reIsNative : reIsHostCtor;
          return pattern.test(toSource(value));
        }

        /**
         * The base implementation of `_.isRegExp` without Node.js optimizations.
         *
         * @private
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a regexp, else `false`.
         */
        function baseIsRegExp(value) {
          return isObjectLike(value) && baseGetTag(value) == regexpTag;
        }

        /**
         * The base implementation of `_.isSet` without Node.js optimizations.
         *
         * @private
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a set, else `false`.
         */
        function baseIsSet(value) {
          return isObjectLike(value) && getTag(value) == setTag;
        }

        /**
         * The base implementation of `_.isTypedArray` without Node.js optimizations.
         *
         * @private
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
         */
        function baseIsTypedArray(value) {
          return isObjectLike(value) &&
            isLength(value.length) && !!typedArrayTags[baseGetTag(value)];
        }

        /**
         * The base implementation of `_.iteratee`.
         *
         * @private
         * @param {*} [value=_.identity] The value to convert to an iteratee.
         * @returns {Function} Returns the iteratee.
         */
        function baseIteratee(value) {
          // Don't store the `typeof` result in a variable to avoid a JIT bug in Safari 9.
          // See https://bugs.webkit.org/show_bug.cgi?id=156034 for more details.
          if (typeof value == 'function') {
            return value;
          }
          if (value == null) {
            return identity;
          }
          if (typeof value == 'object') {
            return isArray(value)
              ? baseMatchesProperty(value[0], value[1])
              : baseMatches(value);
          }
          return property(value);
        }

        /**
         * The base implementation of `_.keys` which doesn't treat sparse arrays as dense.
         *
         * @private
         * @param {Object} object The object to query.
         * @returns {Array} Returns the array of property names.
         */
        function baseKeys(object) {
          if (!isPrototype(object)) {
            return nativeKeys(object);
          }
          var result = [];
          for (var key in Object(object)) {
            if (hasOwnProperty.call(object, key) && key != 'constructor') {
              result.push(key);
            }
          }
          return result;
        }

        /**
         * The base implementation of `_.keysIn` which doesn't treat sparse arrays as dense.
         *
         * @private
         * @param {Object} object The object to query.
         * @returns {Array} Returns the array of property names.
         */
        function baseKeysIn(object) {
          if (!isObject(object)) {
            return nativeKeysIn(object);
          }
          var isProto = isPrototype(object),
              result = [];

          for (var key in object) {
            if (!(key == 'constructor' && (isProto || !hasOwnProperty.call(object, key)))) {
              result.push(key);
            }
          }
          return result;
        }

        /**
         * The base implementation of `_.lt` which doesn't coerce arguments.
         *
         * @private
         * @param {*} value The value to compare.
         * @param {*} other The other value to compare.
         * @returns {boolean} Returns `true` if `value` is less than `other`,
         *  else `false`.
         */
        function baseLt(value, other) {
          return value < other;
        }

        /**
         * The base implementation of `_.map` without support for iteratee shorthands.
         *
         * @private
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} iteratee The function invoked per iteration.
         * @returns {Array} Returns the new mapped array.
         */
        function baseMap(collection, iteratee) {
          var index = -1,
              result = isArrayLike(collection) ? Array(collection.length) : [];

          baseEach(collection, function(value, key, collection) {
            result[++index] = iteratee(value, key, collection);
          });
          return result;
        }

        /**
         * The base implementation of `_.matches` which doesn't clone `source`.
         *
         * @private
         * @param {Object} source The object of property values to match.
         * @returns {Function} Returns the new spec function.
         */
        function baseMatches(source) {
          var matchData = getMatchData(source);
          if (matchData.length == 1 && matchData[0][2]) {
            return matchesStrictComparable(matchData[0][0], matchData[0][1]);
          }
          return function(object) {
            return object === source || baseIsMatch(object, source, matchData);
          };
        }

        /**
         * The base implementation of `_.matchesProperty` which doesn't clone `srcValue`.
         *
         * @private
         * @param {string} path The path of the property to get.
         * @param {*} srcValue The value to match.
         * @returns {Function} Returns the new spec function.
         */
        function baseMatchesProperty(path, srcValue) {
          if (isKey(path) && isStrictComparable(srcValue)) {
            return matchesStrictComparable(toKey(path), srcValue);
          }
          return function(object) {
            var objValue = get(object, path);
            return (objValue === undefined$1 && objValue === srcValue)
              ? hasIn(object, path)
              : baseIsEqual(srcValue, objValue, COMPARE_PARTIAL_FLAG | COMPARE_UNORDERED_FLAG);
          };
        }

        /**
         * The base implementation of `_.merge` without support for multiple sources.
         *
         * @private
         * @param {Object} object The destination object.
         * @param {Object} source The source object.
         * @param {number} srcIndex The index of `source`.
         * @param {Function} [customizer] The function to customize merged values.
         * @param {Object} [stack] Tracks traversed source values and their merged
         *  counterparts.
         */
        function baseMerge(object, source, srcIndex, customizer, stack) {
          if (object === source) {
            return;
          }
          baseFor(source, function(srcValue, key) {
            stack || (stack = new Stack);
            if (isObject(srcValue)) {
              baseMergeDeep(object, source, key, srcIndex, baseMerge, customizer, stack);
            }
            else {
              var newValue = customizer
                ? customizer(safeGet(object, key), srcValue, (key + ''), object, source, stack)
                : undefined$1;

              if (newValue === undefined$1) {
                newValue = srcValue;
              }
              assignMergeValue(object, key, newValue);
            }
          }, keysIn);
        }

        /**
         * A specialized version of `baseMerge` for arrays and objects which performs
         * deep merges and tracks traversed objects enabling objects with circular
         * references to be merged.
         *
         * @private
         * @param {Object} object The destination object.
         * @param {Object} source The source object.
         * @param {string} key The key of the value to merge.
         * @param {number} srcIndex The index of `source`.
         * @param {Function} mergeFunc The function to merge values.
         * @param {Function} [customizer] The function to customize assigned values.
         * @param {Object} [stack] Tracks traversed source values and their merged
         *  counterparts.
         */
        function baseMergeDeep(object, source, key, srcIndex, mergeFunc, customizer, stack) {
          var objValue = safeGet(object, key),
              srcValue = safeGet(source, key),
              stacked = stack.get(srcValue);

          if (stacked) {
            assignMergeValue(object, key, stacked);
            return;
          }
          var newValue = customizer
            ? customizer(objValue, srcValue, (key + ''), object, source, stack)
            : undefined$1;

          var isCommon = newValue === undefined$1;

          if (isCommon) {
            var isArr = isArray(srcValue),
                isBuff = !isArr && isBuffer(srcValue),
                isTyped = !isArr && !isBuff && isTypedArray(srcValue);

            newValue = srcValue;
            if (isArr || isBuff || isTyped) {
              if (isArray(objValue)) {
                newValue = objValue;
              }
              else if (isArrayLikeObject(objValue)) {
                newValue = copyArray(objValue);
              }
              else if (isBuff) {
                isCommon = false;
                newValue = cloneBuffer(srcValue, true);
              }
              else if (isTyped) {
                isCommon = false;
                newValue = cloneTypedArray(srcValue, true);
              }
              else {
                newValue = [];
              }
            }
            else if (isPlainObject(srcValue) || isArguments(srcValue)) {
              newValue = objValue;
              if (isArguments(objValue)) {
                newValue = toPlainObject(objValue);
              }
              else if (!isObject(objValue) || isFunction(objValue)) {
                newValue = initCloneObject(srcValue);
              }
            }
            else {
              isCommon = false;
            }
          }
          if (isCommon) {
            // Recursively merge objects and arrays (susceptible to call stack limits).
            stack.set(srcValue, newValue);
            mergeFunc(newValue, srcValue, srcIndex, customizer, stack);
            stack['delete'](srcValue);
          }
          assignMergeValue(object, key, newValue);
        }

        /**
         * The base implementation of `_.nth` which doesn't coerce arguments.
         *
         * @private
         * @param {Array} array The array to query.
         * @param {number} n The index of the element to return.
         * @returns {*} Returns the nth element of `array`.
         */
        function baseNth(array, n) {
          var length = array.length;
          if (!length) {
            return;
          }
          n += n < 0 ? length : 0;
          return isIndex(n, length) ? array[n] : undefined$1;
        }

        /**
         * The base implementation of `_.orderBy` without param guards.
         *
         * @private
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function[]|Object[]|string[]} iteratees The iteratees to sort by.
         * @param {string[]} orders The sort orders of `iteratees`.
         * @returns {Array} Returns the new sorted array.
         */
        function baseOrderBy(collection, iteratees, orders) {
          if (iteratees.length) {
            iteratees = arrayMap(iteratees, function(iteratee) {
              if (isArray(iteratee)) {
                return function(value) {
                  return baseGet(value, iteratee.length === 1 ? iteratee[0] : iteratee);
                }
              }
              return iteratee;
            });
          } else {
            iteratees = [identity];
          }

          var index = -1;
          iteratees = arrayMap(iteratees, baseUnary(getIteratee()));

          var result = baseMap(collection, function(value, key, collection) {
            var criteria = arrayMap(iteratees, function(iteratee) {
              return iteratee(value);
            });
            return { 'criteria': criteria, 'index': ++index, 'value': value };
          });

          return baseSortBy(result, function(object, other) {
            return compareMultiple(object, other, orders);
          });
        }

        /**
         * The base implementation of `_.pick` without support for individual
         * property identifiers.
         *
         * @private
         * @param {Object} object The source object.
         * @param {string[]} paths The property paths to pick.
         * @returns {Object} Returns the new object.
         */
        function basePick(object, paths) {
          return basePickBy(object, paths, function(value, path) {
            return hasIn(object, path);
          });
        }

        /**
         * The base implementation of  `_.pickBy` without support for iteratee shorthands.
         *
         * @private
         * @param {Object} object The source object.
         * @param {string[]} paths The property paths to pick.
         * @param {Function} predicate The function invoked per property.
         * @returns {Object} Returns the new object.
         */
        function basePickBy(object, paths, predicate) {
          var index = -1,
              length = paths.length,
              result = {};

          while (++index < length) {
            var path = paths[index],
                value = baseGet(object, path);

            if (predicate(value, path)) {
              baseSet(result, castPath(path, object), value);
            }
          }
          return result;
        }

        /**
         * A specialized version of `baseProperty` which supports deep paths.
         *
         * @private
         * @param {Array|string} path The path of the property to get.
         * @returns {Function} Returns the new accessor function.
         */
        function basePropertyDeep(path) {
          return function(object) {
            return baseGet(object, path);
          };
        }

        /**
         * The base implementation of `_.pullAllBy` without support for iteratee
         * shorthands.
         *
         * @private
         * @param {Array} array The array to modify.
         * @param {Array} values The values to remove.
         * @param {Function} [iteratee] The iteratee invoked per element.
         * @param {Function} [comparator] The comparator invoked per element.
         * @returns {Array} Returns `array`.
         */
        function basePullAll(array, values, iteratee, comparator) {
          var indexOf = comparator ? baseIndexOfWith : baseIndexOf,
              index = -1,
              length = values.length,
              seen = array;

          if (array === values) {
            values = copyArray(values);
          }
          if (iteratee) {
            seen = arrayMap(array, baseUnary(iteratee));
          }
          while (++index < length) {
            var fromIndex = 0,
                value = values[index],
                computed = iteratee ? iteratee(value) : value;

            while ((fromIndex = indexOf(seen, computed, fromIndex, comparator)) > -1) {
              if (seen !== array) {
                splice.call(seen, fromIndex, 1);
              }
              splice.call(array, fromIndex, 1);
            }
          }
          return array;
        }

        /**
         * The base implementation of `_.pullAt` without support for individual
         * indexes or capturing the removed elements.
         *
         * @private
         * @param {Array} array The array to modify.
         * @param {number[]} indexes The indexes of elements to remove.
         * @returns {Array} Returns `array`.
         */
        function basePullAt(array, indexes) {
          var length = array ? indexes.length : 0,
              lastIndex = length - 1;

          while (length--) {
            var index = indexes[length];
            if (length == lastIndex || index !== previous) {
              var previous = index;
              if (isIndex(index)) {
                splice.call(array, index, 1);
              } else {
                baseUnset(array, index);
              }
            }
          }
          return array;
        }

        /**
         * The base implementation of `_.random` without support for returning
         * floating-point numbers.
         *
         * @private
         * @param {number} lower The lower bound.
         * @param {number} upper The upper bound.
         * @returns {number} Returns the random number.
         */
        function baseRandom(lower, upper) {
          return lower + nativeFloor(nativeRandom() * (upper - lower + 1));
        }

        /**
         * The base implementation of `_.range` and `_.rangeRight` which doesn't
         * coerce arguments.
         *
         * @private
         * @param {number} start The start of the range.
         * @param {number} end The end of the range.
         * @param {number} step The value to increment or decrement by.
         * @param {boolean} [fromRight] Specify iterating from right to left.
         * @returns {Array} Returns the range of numbers.
         */
        function baseRange(start, end, step, fromRight) {
          var index = -1,
              length = nativeMax(nativeCeil((end - start) / (step || 1)), 0),
              result = Array(length);

          while (length--) {
            result[fromRight ? length : ++index] = start;
            start += step;
          }
          return result;
        }

        /**
         * The base implementation of `_.repeat` which doesn't coerce arguments.
         *
         * @private
         * @param {string} string The string to repeat.
         * @param {number} n The number of times to repeat the string.
         * @returns {string} Returns the repeated string.
         */
        function baseRepeat(string, n) {
          var result = '';
          if (!string || n < 1 || n > MAX_SAFE_INTEGER) {
            return result;
          }
          // Leverage the exponentiation by squaring algorithm for a faster repeat.
          // See https://en.wikipedia.org/wiki/Exponentiation_by_squaring for more details.
          do {
            if (n % 2) {
              result += string;
            }
            n = nativeFloor(n / 2);
            if (n) {
              string += string;
            }
          } while (n);

          return result;
        }

        /**
         * The base implementation of `_.rest` which doesn't validate or coerce arguments.
         *
         * @private
         * @param {Function} func The function to apply a rest parameter to.
         * @param {number} [start=func.length-1] The start position of the rest parameter.
         * @returns {Function} Returns the new function.
         */
        function baseRest(func, start) {
          return setToString(overRest(func, start, identity), func + '');
        }

        /**
         * The base implementation of `_.sample`.
         *
         * @private
         * @param {Array|Object} collection The collection to sample.
         * @returns {*} Returns the random element.
         */
        function baseSample(collection) {
          return arraySample(values(collection));
        }

        /**
         * The base implementation of `_.sampleSize` without param guards.
         *
         * @private
         * @param {Array|Object} collection The collection to sample.
         * @param {number} n The number of elements to sample.
         * @returns {Array} Returns the random elements.
         */
        function baseSampleSize(collection, n) {
          var array = values(collection);
          return shuffleSelf(array, baseClamp(n, 0, array.length));
        }

        /**
         * The base implementation of `_.set`.
         *
         * @private
         * @param {Object} object The object to modify.
         * @param {Array|string} path The path of the property to set.
         * @param {*} value The value to set.
         * @param {Function} [customizer] The function to customize path creation.
         * @returns {Object} Returns `object`.
         */
        function baseSet(object, path, value, customizer) {
          if (!isObject(object)) {
            return object;
          }
          path = castPath(path, object);

          var index = -1,
              length = path.length,
              lastIndex = length - 1,
              nested = object;

          while (nested != null && ++index < length) {
            var key = toKey(path[index]),
                newValue = value;

            if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
              return object;
            }

            if (index != lastIndex) {
              var objValue = nested[key];
              newValue = customizer ? customizer(objValue, key, nested) : undefined$1;
              if (newValue === undefined$1) {
                newValue = isObject(objValue)
                  ? objValue
                  : (isIndex(path[index + 1]) ? [] : {});
              }
            }
            assignValue(nested, key, newValue);
            nested = nested[key];
          }
          return object;
        }

        /**
         * The base implementation of `setData` without support for hot loop shorting.
         *
         * @private
         * @param {Function} func The function to associate metadata with.
         * @param {*} data The metadata.
         * @returns {Function} Returns `func`.
         */
        var baseSetData = !metaMap ? identity : function(func, data) {
          metaMap.set(func, data);
          return func;
        };

        /**
         * The base implementation of `setToString` without support for hot loop shorting.
         *
         * @private
         * @param {Function} func The function to modify.
         * @param {Function} string The `toString` result.
         * @returns {Function} Returns `func`.
         */
        var baseSetToString = !defineProperty ? identity : function(func, string) {
          return defineProperty(func, 'toString', {
            'configurable': true,
            'enumerable': false,
            'value': constant(string),
            'writable': true
          });
        };

        /**
         * The base implementation of `_.shuffle`.
         *
         * @private
         * @param {Array|Object} collection The collection to shuffle.
         * @returns {Array} Returns the new shuffled array.
         */
        function baseShuffle(collection) {
          return shuffleSelf(values(collection));
        }

        /**
         * The base implementation of `_.slice` without an iteratee call guard.
         *
         * @private
         * @param {Array} array The array to slice.
         * @param {number} [start=0] The start position.
         * @param {number} [end=array.length] The end position.
         * @returns {Array} Returns the slice of `array`.
         */
        function baseSlice(array, start, end) {
          var index = -1,
              length = array.length;

          if (start < 0) {
            start = -start > length ? 0 : (length + start);
          }
          end = end > length ? length : end;
          if (end < 0) {
            end += length;
          }
          length = start > end ? 0 : ((end - start) >>> 0);
          start >>>= 0;

          var result = Array(length);
          while (++index < length) {
            result[index] = array[index + start];
          }
          return result;
        }

        /**
         * The base implementation of `_.some` without support for iteratee shorthands.
         *
         * @private
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} predicate The function invoked per iteration.
         * @returns {boolean} Returns `true` if any element passes the predicate check,
         *  else `false`.
         */
        function baseSome(collection, predicate) {
          var result;

          baseEach(collection, function(value, index, collection) {
            result = predicate(value, index, collection);
            return !result;
          });
          return !!result;
        }

        /**
         * The base implementation of `_.sortedIndex` and `_.sortedLastIndex` which
         * performs a binary search of `array` to determine the index at which `value`
         * should be inserted into `array` in order to maintain its sort order.
         *
         * @private
         * @param {Array} array The sorted array to inspect.
         * @param {*} value The value to evaluate.
         * @param {boolean} [retHighest] Specify returning the highest qualified index.
         * @returns {number} Returns the index at which `value` should be inserted
         *  into `array`.
         */
        function baseSortedIndex(array, value, retHighest) {
          var low = 0,
              high = array == null ? low : array.length;

          if (typeof value == 'number' && value === value && high <= HALF_MAX_ARRAY_LENGTH) {
            while (low < high) {
              var mid = (low + high) >>> 1,
                  computed = array[mid];

              if (computed !== null && !isSymbol(computed) &&
                  (retHighest ? (computed <= value) : (computed < value))) {
                low = mid + 1;
              } else {
                high = mid;
              }
            }
            return high;
          }
          return baseSortedIndexBy(array, value, identity, retHighest);
        }

        /**
         * The base implementation of `_.sortedIndexBy` and `_.sortedLastIndexBy`
         * which invokes `iteratee` for `value` and each element of `array` to compute
         * their sort ranking. The iteratee is invoked with one argument; (value).
         *
         * @private
         * @param {Array} array The sorted array to inspect.
         * @param {*} value The value to evaluate.
         * @param {Function} iteratee The iteratee invoked per element.
         * @param {boolean} [retHighest] Specify returning the highest qualified index.
         * @returns {number} Returns the index at which `value` should be inserted
         *  into `array`.
         */
        function baseSortedIndexBy(array, value, iteratee, retHighest) {
          var low = 0,
              high = array == null ? 0 : array.length;
          if (high === 0) {
            return 0;
          }

          value = iteratee(value);
          var valIsNaN = value !== value,
              valIsNull = value === null,
              valIsSymbol = isSymbol(value),
              valIsUndefined = value === undefined$1;

          while (low < high) {
            var mid = nativeFloor((low + high) / 2),
                computed = iteratee(array[mid]),
                othIsDefined = computed !== undefined$1,
                othIsNull = computed === null,
                othIsReflexive = computed === computed,
                othIsSymbol = isSymbol(computed);

            if (valIsNaN) {
              var setLow = retHighest || othIsReflexive;
            } else if (valIsUndefined) {
              setLow = othIsReflexive && (retHighest || othIsDefined);
            } else if (valIsNull) {
              setLow = othIsReflexive && othIsDefined && (retHighest || !othIsNull);
            } else if (valIsSymbol) {
              setLow = othIsReflexive && othIsDefined && !othIsNull && (retHighest || !othIsSymbol);
            } else if (othIsNull || othIsSymbol) {
              setLow = false;
            } else {
              setLow = retHighest ? (computed <= value) : (computed < value);
            }
            if (setLow) {
              low = mid + 1;
            } else {
              high = mid;
            }
          }
          return nativeMin(high, MAX_ARRAY_INDEX);
        }

        /**
         * The base implementation of `_.sortedUniq` and `_.sortedUniqBy` without
         * support for iteratee shorthands.
         *
         * @private
         * @param {Array} array The array to inspect.
         * @param {Function} [iteratee] The iteratee invoked per element.
         * @returns {Array} Returns the new duplicate free array.
         */
        function baseSortedUniq(array, iteratee) {
          var index = -1,
              length = array.length,
              resIndex = 0,
              result = [];

          while (++index < length) {
            var value = array[index],
                computed = iteratee ? iteratee(value) : value;

            if (!index || !eq(computed, seen)) {
              var seen = computed;
              result[resIndex++] = value === 0 ? 0 : value;
            }
          }
          return result;
        }

        /**
         * The base implementation of `_.toNumber` which doesn't ensure correct
         * conversions of binary, hexadecimal, or octal string values.
         *
         * @private
         * @param {*} value The value to process.
         * @returns {number} Returns the number.
         */
        function baseToNumber(value) {
          if (typeof value == 'number') {
            return value;
          }
          if (isSymbol(value)) {
            return NAN;
          }
          return +value;
        }

        /**
         * The base implementation of `_.toString` which doesn't convert nullish
         * values to empty strings.
         *
         * @private
         * @param {*} value The value to process.
         * @returns {string} Returns the string.
         */
        function baseToString(value) {
          // Exit early for strings to avoid a performance hit in some environments.
          if (typeof value == 'string') {
            return value;
          }
          if (isArray(value)) {
            // Recursively convert values (susceptible to call stack limits).
            return arrayMap(value, baseToString) + '';
          }
          if (isSymbol(value)) {
            return symbolToString ? symbolToString.call(value) : '';
          }
          var result = (value + '');
          return (result == '0' && (1 / value) == -INFINITY) ? '-0' : result;
        }

        /**
         * The base implementation of `_.uniqBy` without support for iteratee shorthands.
         *
         * @private
         * @param {Array} array The array to inspect.
         * @param {Function} [iteratee] The iteratee invoked per element.
         * @param {Function} [comparator] The comparator invoked per element.
         * @returns {Array} Returns the new duplicate free array.
         */
        function baseUniq(array, iteratee, comparator) {
          var index = -1,
              includes = arrayIncludes,
              length = array.length,
              isCommon = true,
              result = [],
              seen = result;

          if (comparator) {
            isCommon = false;
            includes = arrayIncludesWith;
          }
          else if (length >= LARGE_ARRAY_SIZE) {
            var set = iteratee ? null : createSet(array);
            if (set) {
              return setToArray(set);
            }
            isCommon = false;
            includes = cacheHas;
            seen = new SetCache;
          }
          else {
            seen = iteratee ? [] : result;
          }
          outer:
          while (++index < length) {
            var value = array[index],
                computed = iteratee ? iteratee(value) : value;

            value = (comparator || value !== 0) ? value : 0;
            if (isCommon && computed === computed) {
              var seenIndex = seen.length;
              while (seenIndex--) {
                if (seen[seenIndex] === computed) {
                  continue outer;
                }
              }
              if (iteratee) {
                seen.push(computed);
              }
              result.push(value);
            }
            else if (!includes(seen, computed, comparator)) {
              if (seen !== result) {
                seen.push(computed);
              }
              result.push(value);
            }
          }
          return result;
        }

        /**
         * The base implementation of `_.unset`.
         *
         * @private
         * @param {Object} object The object to modify.
         * @param {Array|string} path The property path to unset.
         * @returns {boolean} Returns `true` if the property is deleted, else `false`.
         */
        function baseUnset(object, path) {
          path = castPath(path, object);
          object = parent(object, path);
          return object == null || delete object[toKey(last(path))];
        }

        /**
         * The base implementation of `_.update`.
         *
         * @private
         * @param {Object} object The object to modify.
         * @param {Array|string} path The path of the property to update.
         * @param {Function} updater The function to produce the updated value.
         * @param {Function} [customizer] The function to customize path creation.
         * @returns {Object} Returns `object`.
         */
        function baseUpdate(object, path, updater, customizer) {
          return baseSet(object, path, updater(baseGet(object, path)), customizer);
        }

        /**
         * The base implementation of methods like `_.dropWhile` and `_.takeWhile`
         * without support for iteratee shorthands.
         *
         * @private
         * @param {Array} array The array to query.
         * @param {Function} predicate The function invoked per iteration.
         * @param {boolean} [isDrop] Specify dropping elements instead of taking them.
         * @param {boolean} [fromRight] Specify iterating from right to left.
         * @returns {Array} Returns the slice of `array`.
         */
        function baseWhile(array, predicate, isDrop, fromRight) {
          var length = array.length,
              index = fromRight ? length : -1;

          while ((fromRight ? index-- : ++index < length) &&
            predicate(array[index], index, array)) {}

          return isDrop
            ? baseSlice(array, (fromRight ? 0 : index), (fromRight ? index + 1 : length))
            : baseSlice(array, (fromRight ? index + 1 : 0), (fromRight ? length : index));
        }

        /**
         * The base implementation of `wrapperValue` which returns the result of
         * performing a sequence of actions on the unwrapped `value`, where each
         * successive action is supplied the return value of the previous.
         *
         * @private
         * @param {*} value The unwrapped value.
         * @param {Array} actions Actions to perform to resolve the unwrapped value.
         * @returns {*} Returns the resolved value.
         */
        function baseWrapperValue(value, actions) {
          var result = value;
          if (result instanceof LazyWrapper) {
            result = result.value();
          }
          return arrayReduce(actions, function(result, action) {
            return action.func.apply(action.thisArg, arrayPush([result], action.args));
          }, result);
        }

        /**
         * The base implementation of methods like `_.xor`, without support for
         * iteratee shorthands, that accepts an array of arrays to inspect.
         *
         * @private
         * @param {Array} arrays The arrays to inspect.
         * @param {Function} [iteratee] The iteratee invoked per element.
         * @param {Function} [comparator] The comparator invoked per element.
         * @returns {Array} Returns the new array of values.
         */
        function baseXor(arrays, iteratee, comparator) {
          var length = arrays.length;
          if (length < 2) {
            return length ? baseUniq(arrays[0]) : [];
          }
          var index = -1,
              result = Array(length);

          while (++index < length) {
            var array = arrays[index],
                othIndex = -1;

            while (++othIndex < length) {
              if (othIndex != index) {
                result[index] = baseDifference(result[index] || array, arrays[othIndex], iteratee, comparator);
              }
            }
          }
          return baseUniq(baseFlatten(result, 1), iteratee, comparator);
        }

        /**
         * This base implementation of `_.zipObject` which assigns values using `assignFunc`.
         *
         * @private
         * @param {Array} props The property identifiers.
         * @param {Array} values The property values.
         * @param {Function} assignFunc The function to assign values.
         * @returns {Object} Returns the new object.
         */
        function baseZipObject(props, values, assignFunc) {
          var index = -1,
              length = props.length,
              valsLength = values.length,
              result = {};

          while (++index < length) {
            var value = index < valsLength ? values[index] : undefined$1;
            assignFunc(result, props[index], value);
          }
          return result;
        }

        /**
         * Casts `value` to an empty array if it's not an array like object.
         *
         * @private
         * @param {*} value The value to inspect.
         * @returns {Array|Object} Returns the cast array-like object.
         */
        function castArrayLikeObject(value) {
          return isArrayLikeObject(value) ? value : [];
        }

        /**
         * Casts `value` to `identity` if it's not a function.
         *
         * @private
         * @param {*} value The value to inspect.
         * @returns {Function} Returns cast function.
         */
        function castFunction(value) {
          return typeof value == 'function' ? value : identity;
        }

        /**
         * Casts `value` to a path array if it's not one.
         *
         * @private
         * @param {*} value The value to inspect.
         * @param {Object} [object] The object to query keys on.
         * @returns {Array} Returns the cast property path array.
         */
        function castPath(value, object) {
          if (isArray(value)) {
            return value;
          }
          return isKey(value, object) ? [value] : stringToPath(toString(value));
        }

        /**
         * A `baseRest` alias which can be replaced with `identity` by module
         * replacement plugins.
         *
         * @private
         * @type {Function}
         * @param {Function} func The function to apply a rest parameter to.
         * @returns {Function} Returns the new function.
         */
        var castRest = baseRest;

        /**
         * Casts `array` to a slice if it's needed.
         *
         * @private
         * @param {Array} array The array to inspect.
         * @param {number} start The start position.
         * @param {number} [end=array.length] The end position.
         * @returns {Array} Returns the cast slice.
         */
        function castSlice(array, start, end) {
          var length = array.length;
          end = end === undefined$1 ? length : end;
          return (!start && end >= length) ? array : baseSlice(array, start, end);
        }

        /**
         * A simple wrapper around the global [`clearTimeout`](https://mdn.io/clearTimeout).
         *
         * @private
         * @param {number|Object} id The timer id or timeout object of the timer to clear.
         */
        var clearTimeout = ctxClearTimeout || function(id) {
          return root.clearTimeout(id);
        };

        /**
         * Creates a clone of  `buffer`.
         *
         * @private
         * @param {Buffer} buffer The buffer to clone.
         * @param {boolean} [isDeep] Specify a deep clone.
         * @returns {Buffer} Returns the cloned buffer.
         */
        function cloneBuffer(buffer, isDeep) {
          if (isDeep) {
            return buffer.slice();
          }
          var length = buffer.length,
              result = allocUnsafe ? allocUnsafe(length) : new buffer.constructor(length);

          buffer.copy(result);
          return result;
        }

        /**
         * Creates a clone of `arrayBuffer`.
         *
         * @private
         * @param {ArrayBuffer} arrayBuffer The array buffer to clone.
         * @returns {ArrayBuffer} Returns the cloned array buffer.
         */
        function cloneArrayBuffer(arrayBuffer) {
          var result = new arrayBuffer.constructor(arrayBuffer.byteLength);
          new Uint8Array(result).set(new Uint8Array(arrayBuffer));
          return result;
        }

        /**
         * Creates a clone of `dataView`.
         *
         * @private
         * @param {Object} dataView The data view to clone.
         * @param {boolean} [isDeep] Specify a deep clone.
         * @returns {Object} Returns the cloned data view.
         */
        function cloneDataView(dataView, isDeep) {
          var buffer = isDeep ? cloneArrayBuffer(dataView.buffer) : dataView.buffer;
          return new dataView.constructor(buffer, dataView.byteOffset, dataView.byteLength);
        }

        /**
         * Creates a clone of `regexp`.
         *
         * @private
         * @param {Object} regexp The regexp to clone.
         * @returns {Object} Returns the cloned regexp.
         */
        function cloneRegExp(regexp) {
          var result = new regexp.constructor(regexp.source, reFlags.exec(regexp));
          result.lastIndex = regexp.lastIndex;
          return result;
        }

        /**
         * Creates a clone of the `symbol` object.
         *
         * @private
         * @param {Object} symbol The symbol object to clone.
         * @returns {Object} Returns the cloned symbol object.
         */
        function cloneSymbol(symbol) {
          return symbolValueOf ? Object(symbolValueOf.call(symbol)) : {};
        }

        /**
         * Creates a clone of `typedArray`.
         *
         * @private
         * @param {Object} typedArray The typed array to clone.
         * @param {boolean} [isDeep] Specify a deep clone.
         * @returns {Object} Returns the cloned typed array.
         */
        function cloneTypedArray(typedArray, isDeep) {
          var buffer = isDeep ? cloneArrayBuffer(typedArray.buffer) : typedArray.buffer;
          return new typedArray.constructor(buffer, typedArray.byteOffset, typedArray.length);
        }

        /**
         * Compares values to sort them in ascending order.
         *
         * @private
         * @param {*} value The value to compare.
         * @param {*} other The other value to compare.
         * @returns {number} Returns the sort order indicator for `value`.
         */
        function compareAscending(value, other) {
          if (value !== other) {
            var valIsDefined = value !== undefined$1,
                valIsNull = value === null,
                valIsReflexive = value === value,
                valIsSymbol = isSymbol(value);

            var othIsDefined = other !== undefined$1,
                othIsNull = other === null,
                othIsReflexive = other === other,
                othIsSymbol = isSymbol(other);

            if ((!othIsNull && !othIsSymbol && !valIsSymbol && value > other) ||
                (valIsSymbol && othIsDefined && othIsReflexive && !othIsNull && !othIsSymbol) ||
                (valIsNull && othIsDefined && othIsReflexive) ||
                (!valIsDefined && othIsReflexive) ||
                !valIsReflexive) {
              return 1;
            }
            if ((!valIsNull && !valIsSymbol && !othIsSymbol && value < other) ||
                (othIsSymbol && valIsDefined && valIsReflexive && !valIsNull && !valIsSymbol) ||
                (othIsNull && valIsDefined && valIsReflexive) ||
                (!othIsDefined && valIsReflexive) ||
                !othIsReflexive) {
              return -1;
            }
          }
          return 0;
        }

        /**
         * Used by `_.orderBy` to compare multiple properties of a value to another
         * and stable sort them.
         *
         * If `orders` is unspecified, all values are sorted in ascending order. Otherwise,
         * specify an order of "desc" for descending or "asc" for ascending sort order
         * of corresponding values.
         *
         * @private
         * @param {Object} object The object to compare.
         * @param {Object} other The other object to compare.
         * @param {boolean[]|string[]} orders The order to sort by for each property.
         * @returns {number} Returns the sort order indicator for `object`.
         */
        function compareMultiple(object, other, orders) {
          var index = -1,
              objCriteria = object.criteria,
              othCriteria = other.criteria,
              length = objCriteria.length,
              ordersLength = orders.length;

          while (++index < length) {
            var result = compareAscending(objCriteria[index], othCriteria[index]);
            if (result) {
              if (index >= ordersLength) {
                return result;
              }
              var order = orders[index];
              return result * (order == 'desc' ? -1 : 1);
            }
          }
          // Fixes an `Array#sort` bug in the JS engine embedded in Adobe applications
          // that causes it, under certain circumstances, to provide the same value for
          // `object` and `other`. See https://github.com/jashkenas/underscore/pull/1247
          // for more details.
          //
          // This also ensures a stable sort in V8 and other engines.
          // See https://bugs.chromium.org/p/v8/issues/detail?id=90 for more details.
          return object.index - other.index;
        }

        /**
         * Creates an array that is the composition of partially applied arguments,
         * placeholders, and provided arguments into a single array of arguments.
         *
         * @private
         * @param {Array} args The provided arguments.
         * @param {Array} partials The arguments to prepend to those provided.
         * @param {Array} holders The `partials` placeholder indexes.
         * @params {boolean} [isCurried] Specify composing for a curried function.
         * @returns {Array} Returns the new array of composed arguments.
         */
        function composeArgs(args, partials, holders, isCurried) {
          var argsIndex = -1,
              argsLength = args.length,
              holdersLength = holders.length,
              leftIndex = -1,
              leftLength = partials.length,
              rangeLength = nativeMax(argsLength - holdersLength, 0),
              result = Array(leftLength + rangeLength),
              isUncurried = !isCurried;

          while (++leftIndex < leftLength) {
            result[leftIndex] = partials[leftIndex];
          }
          while (++argsIndex < holdersLength) {
            if (isUncurried || argsIndex < argsLength) {
              result[holders[argsIndex]] = args[argsIndex];
            }
          }
          while (rangeLength--) {
            result[leftIndex++] = args[argsIndex++];
          }
          return result;
        }

        /**
         * This function is like `composeArgs` except that the arguments composition
         * is tailored for `_.partialRight`.
         *
         * @private
         * @param {Array} args The provided arguments.
         * @param {Array} partials The arguments to append to those provided.
         * @param {Array} holders The `partials` placeholder indexes.
         * @params {boolean} [isCurried] Specify composing for a curried function.
         * @returns {Array} Returns the new array of composed arguments.
         */
        function composeArgsRight(args, partials, holders, isCurried) {
          var argsIndex = -1,
              argsLength = args.length,
              holdersIndex = -1,
              holdersLength = holders.length,
              rightIndex = -1,
              rightLength = partials.length,
              rangeLength = nativeMax(argsLength - holdersLength, 0),
              result = Array(rangeLength + rightLength),
              isUncurried = !isCurried;

          while (++argsIndex < rangeLength) {
            result[argsIndex] = args[argsIndex];
          }
          var offset = argsIndex;
          while (++rightIndex < rightLength) {
            result[offset + rightIndex] = partials[rightIndex];
          }
          while (++holdersIndex < holdersLength) {
            if (isUncurried || argsIndex < argsLength) {
              result[offset + holders[holdersIndex]] = args[argsIndex++];
            }
          }
          return result;
        }

        /**
         * Copies the values of `source` to `array`.
         *
         * @private
         * @param {Array} source The array to copy values from.
         * @param {Array} [array=[]] The array to copy values to.
         * @returns {Array} Returns `array`.
         */
        function copyArray(source, array) {
          var index = -1,
              length = source.length;

          array || (array = Array(length));
          while (++index < length) {
            array[index] = source[index];
          }
          return array;
        }

        /**
         * Copies properties of `source` to `object`.
         *
         * @private
         * @param {Object} source The object to copy properties from.
         * @param {Array} props The property identifiers to copy.
         * @param {Object} [object={}] The object to copy properties to.
         * @param {Function} [customizer] The function to customize copied values.
         * @returns {Object} Returns `object`.
         */
        function copyObject(source, props, object, customizer) {
          var isNew = !object;
          object || (object = {});

          var index = -1,
              length = props.length;

          while (++index < length) {
            var key = props[index];

            var newValue = customizer
              ? customizer(object[key], source[key], key, object, source)
              : undefined$1;

            if (newValue === undefined$1) {
              newValue = source[key];
            }
            if (isNew) {
              baseAssignValue(object, key, newValue);
            } else {
              assignValue(object, key, newValue);
            }
          }
          return object;
        }

        /**
         * Copies own symbols of `source` to `object`.
         *
         * @private
         * @param {Object} source The object to copy symbols from.
         * @param {Object} [object={}] The object to copy symbols to.
         * @returns {Object} Returns `object`.
         */
        function copySymbols(source, object) {
          return copyObject(source, getSymbols(source), object);
        }

        /**
         * Copies own and inherited symbols of `source` to `object`.
         *
         * @private
         * @param {Object} source The object to copy symbols from.
         * @param {Object} [object={}] The object to copy symbols to.
         * @returns {Object} Returns `object`.
         */
        function copySymbolsIn(source, object) {
          return copyObject(source, getSymbolsIn(source), object);
        }

        /**
         * Creates a function like `_.groupBy`.
         *
         * @private
         * @param {Function} setter The function to set accumulator values.
         * @param {Function} [initializer] The accumulator object initializer.
         * @returns {Function} Returns the new aggregator function.
         */
        function createAggregator(setter, initializer) {
          return function(collection, iteratee) {
            var func = isArray(collection) ? arrayAggregator : baseAggregator,
                accumulator = initializer ? initializer() : {};

            return func(collection, setter, getIteratee(iteratee, 2), accumulator);
          };
        }

        /**
         * Creates a function like `_.assign`.
         *
         * @private
         * @param {Function} assigner The function to assign values.
         * @returns {Function} Returns the new assigner function.
         */
        function createAssigner(assigner) {
          return baseRest(function(object, sources) {
            var index = -1,
                length = sources.length,
                customizer = length > 1 ? sources[length - 1] : undefined$1,
                guard = length > 2 ? sources[2] : undefined$1;

            customizer = (assigner.length > 3 && typeof customizer == 'function')
              ? (length--, customizer)
              : undefined$1;

            if (guard && isIterateeCall(sources[0], sources[1], guard)) {
              customizer = length < 3 ? undefined$1 : customizer;
              length = 1;
            }
            object = Object(object);
            while (++index < length) {
              var source = sources[index];
              if (source) {
                assigner(object, source, index, customizer);
              }
            }
            return object;
          });
        }

        /**
         * Creates a `baseEach` or `baseEachRight` function.
         *
         * @private
         * @param {Function} eachFunc The function to iterate over a collection.
         * @param {boolean} [fromRight] Specify iterating from right to left.
         * @returns {Function} Returns the new base function.
         */
        function createBaseEach(eachFunc, fromRight) {
          return function(collection, iteratee) {
            if (collection == null) {
              return collection;
            }
            if (!isArrayLike(collection)) {
              return eachFunc(collection, iteratee);
            }
            var length = collection.length,
                index = fromRight ? length : -1,
                iterable = Object(collection);

            while ((fromRight ? index-- : ++index < length)) {
              if (iteratee(iterable[index], index, iterable) === false) {
                break;
              }
            }
            return collection;
          };
        }

        /**
         * Creates a base function for methods like `_.forIn` and `_.forOwn`.
         *
         * @private
         * @param {boolean} [fromRight] Specify iterating from right to left.
         * @returns {Function} Returns the new base function.
         */
        function createBaseFor(fromRight) {
          return function(object, iteratee, keysFunc) {
            var index = -1,
                iterable = Object(object),
                props = keysFunc(object),
                length = props.length;

            while (length--) {
              var key = props[fromRight ? length : ++index];
              if (iteratee(iterable[key], key, iterable) === false) {
                break;
              }
            }
            return object;
          };
        }

        /**
         * Creates a function that wraps `func` to invoke it with the optional `this`
         * binding of `thisArg`.
         *
         * @private
         * @param {Function} func The function to wrap.
         * @param {number} bitmask The bitmask flags. See `createWrap` for more details.
         * @param {*} [thisArg] The `this` binding of `func`.
         * @returns {Function} Returns the new wrapped function.
         */
        function createBind(func, bitmask, thisArg) {
          var isBind = bitmask & WRAP_BIND_FLAG,
              Ctor = createCtor(func);

          function wrapper() {
            var fn = (this && this !== root && this instanceof wrapper) ? Ctor : func;
            return fn.apply(isBind ? thisArg : this, arguments);
          }
          return wrapper;
        }

        /**
         * Creates a function like `_.lowerFirst`.
         *
         * @private
         * @param {string} methodName The name of the `String` case method to use.
         * @returns {Function} Returns the new case function.
         */
        function createCaseFirst(methodName) {
          return function(string) {
            string = toString(string);

            var strSymbols = hasUnicode(string)
              ? stringToArray(string)
              : undefined$1;

            var chr = strSymbols
              ? strSymbols[0]
              : string.charAt(0);

            var trailing = strSymbols
              ? castSlice(strSymbols, 1).join('')
              : string.slice(1);

            return chr[methodName]() + trailing;
          };
        }

        /**
         * Creates a function like `_.camelCase`.
         *
         * @private
         * @param {Function} callback The function to combine each word.
         * @returns {Function} Returns the new compounder function.
         */
        function createCompounder(callback) {
          return function(string) {
            return arrayReduce(words(deburr(string).replace(reApos, '')), callback, '');
          };
        }

        /**
         * Creates a function that produces an instance of `Ctor` regardless of
         * whether it was invoked as part of a `new` expression or by `call` or `apply`.
         *
         * @private
         * @param {Function} Ctor The constructor to wrap.
         * @returns {Function} Returns the new wrapped function.
         */
        function createCtor(Ctor) {
          return function() {
            // Use a `switch` statement to work with class constructors. See
            // http://ecma-international.org/ecma-262/7.0/#sec-ecmascript-function-objects-call-thisargument-argumentslist
            // for more details.
            var args = arguments;
            switch (args.length) {
              case 0: return new Ctor;
              case 1: return new Ctor(args[0]);
              case 2: return new Ctor(args[0], args[1]);
              case 3: return new Ctor(args[0], args[1], args[2]);
              case 4: return new Ctor(args[0], args[1], args[2], args[3]);
              case 5: return new Ctor(args[0], args[1], args[2], args[3], args[4]);
              case 6: return new Ctor(args[0], args[1], args[2], args[3], args[4], args[5]);
              case 7: return new Ctor(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
            }
            var thisBinding = baseCreate(Ctor.prototype),
                result = Ctor.apply(thisBinding, args);

            // Mimic the constructor's `return` behavior.
            // See https://es5.github.io/#x13.2.2 for more details.
            return isObject(result) ? result : thisBinding;
          };
        }

        /**
         * Creates a function that wraps `func` to enable currying.
         *
         * @private
         * @param {Function} func The function to wrap.
         * @param {number} bitmask The bitmask flags. See `createWrap` for more details.
         * @param {number} arity The arity of `func`.
         * @returns {Function} Returns the new wrapped function.
         */
        function createCurry(func, bitmask, arity) {
          var Ctor = createCtor(func);

          function wrapper() {
            var length = arguments.length,
                args = Array(length),
                index = length,
                placeholder = getHolder(wrapper);

            while (index--) {
              args[index] = arguments[index];
            }
            var holders = (length < 3 && args[0] !== placeholder && args[length - 1] !== placeholder)
              ? []
              : replaceHolders(args, placeholder);

            length -= holders.length;
            if (length < arity) {
              return createRecurry(
                func, bitmask, createHybrid, wrapper.placeholder, undefined$1,
                args, holders, undefined$1, undefined$1, arity - length);
            }
            var fn = (this && this !== root && this instanceof wrapper) ? Ctor : func;
            return apply(fn, this, args);
          }
          return wrapper;
        }

        /**
         * Creates a `_.find` or `_.findLast` function.
         *
         * @private
         * @param {Function} findIndexFunc The function to find the collection index.
         * @returns {Function} Returns the new find function.
         */
        function createFind(findIndexFunc) {
          return function(collection, predicate, fromIndex) {
            var iterable = Object(collection);
            if (!isArrayLike(collection)) {
              var iteratee = getIteratee(predicate, 3);
              collection = keys(collection);
              predicate = function(key) { return iteratee(iterable[key], key, iterable); };
            }
            var index = findIndexFunc(collection, predicate, fromIndex);
            return index > -1 ? iterable[iteratee ? collection[index] : index] : undefined$1;
          };
        }

        /**
         * Creates a `_.flow` or `_.flowRight` function.
         *
         * @private
         * @param {boolean} [fromRight] Specify iterating from right to left.
         * @returns {Function} Returns the new flow function.
         */
        function createFlow(fromRight) {
          return flatRest(function(funcs) {
            var length = funcs.length,
                index = length,
                prereq = LodashWrapper.prototype.thru;

            if (fromRight) {
              funcs.reverse();
            }
            while (index--) {
              var func = funcs[index];
              if (typeof func != 'function') {
                throw new TypeError(FUNC_ERROR_TEXT);
              }
              if (prereq && !wrapper && getFuncName(func) == 'wrapper') {
                var wrapper = new LodashWrapper([], true);
              }
            }
            index = wrapper ? index : length;
            while (++index < length) {
              func = funcs[index];

              var funcName = getFuncName(func),
                  data = funcName == 'wrapper' ? getData(func) : undefined$1;

              if (data && isLaziable(data[0]) &&
                    data[1] == (WRAP_ARY_FLAG | WRAP_CURRY_FLAG | WRAP_PARTIAL_FLAG | WRAP_REARG_FLAG) &&
                    !data[4].length && data[9] == 1
                  ) {
                wrapper = wrapper[getFuncName(data[0])].apply(wrapper, data[3]);
              } else {
                wrapper = (func.length == 1 && isLaziable(func))
                  ? wrapper[funcName]()
                  : wrapper.thru(func);
              }
            }
            return function() {
              var args = arguments,
                  value = args[0];

              if (wrapper && args.length == 1 && isArray(value)) {
                return wrapper.plant(value).value();
              }
              var index = 0,
                  result = length ? funcs[index].apply(this, args) : value;

              while (++index < length) {
                result = funcs[index].call(this, result);
              }
              return result;
            };
          });
        }

        /**
         * Creates a function that wraps `func` to invoke it with optional `this`
         * binding of `thisArg`, partial application, and currying.
         *
         * @private
         * @param {Function|string} func The function or method name to wrap.
         * @param {number} bitmask The bitmask flags. See `createWrap` for more details.
         * @param {*} [thisArg] The `this` binding of `func`.
         * @param {Array} [partials] The arguments to prepend to those provided to
         *  the new function.
         * @param {Array} [holders] The `partials` placeholder indexes.
         * @param {Array} [partialsRight] The arguments to append to those provided
         *  to the new function.
         * @param {Array} [holdersRight] The `partialsRight` placeholder indexes.
         * @param {Array} [argPos] The argument positions of the new function.
         * @param {number} [ary] The arity cap of `func`.
         * @param {number} [arity] The arity of `func`.
         * @returns {Function} Returns the new wrapped function.
         */
        function createHybrid(func, bitmask, thisArg, partials, holders, partialsRight, holdersRight, argPos, ary, arity) {
          var isAry = bitmask & WRAP_ARY_FLAG,
              isBind = bitmask & WRAP_BIND_FLAG,
              isBindKey = bitmask & WRAP_BIND_KEY_FLAG,
              isCurried = bitmask & (WRAP_CURRY_FLAG | WRAP_CURRY_RIGHT_FLAG),
              isFlip = bitmask & WRAP_FLIP_FLAG,
              Ctor = isBindKey ? undefined$1 : createCtor(func);

          function wrapper() {
            var length = arguments.length,
                args = Array(length),
                index = length;

            while (index--) {
              args[index] = arguments[index];
            }
            if (isCurried) {
              var placeholder = getHolder(wrapper),
                  holdersCount = countHolders(args, placeholder);
            }
            if (partials) {
              args = composeArgs(args, partials, holders, isCurried);
            }
            if (partialsRight) {
              args = composeArgsRight(args, partialsRight, holdersRight, isCurried);
            }
            length -= holdersCount;
            if (isCurried && length < arity) {
              var newHolders = replaceHolders(args, placeholder);
              return createRecurry(
                func, bitmask, createHybrid, wrapper.placeholder, thisArg,
                args, newHolders, argPos, ary, arity - length
              );
            }
            var thisBinding = isBind ? thisArg : this,
                fn = isBindKey ? thisBinding[func] : func;

            length = args.length;
            if (argPos) {
              args = reorder(args, argPos);
            } else if (isFlip && length > 1) {
              args.reverse();
            }
            if (isAry && ary < length) {
              args.length = ary;
            }
            if (this && this !== root && this instanceof wrapper) {
              fn = Ctor || createCtor(fn);
            }
            return fn.apply(thisBinding, args);
          }
          return wrapper;
        }

        /**
         * Creates a function like `_.invertBy`.
         *
         * @private
         * @param {Function} setter The function to set accumulator values.
         * @param {Function} toIteratee The function to resolve iteratees.
         * @returns {Function} Returns the new inverter function.
         */
        function createInverter(setter, toIteratee) {
          return function(object, iteratee) {
            return baseInverter(object, setter, toIteratee(iteratee), {});
          };
        }

        /**
         * Creates a function that performs a mathematical operation on two values.
         *
         * @private
         * @param {Function} operator The function to perform the operation.
         * @param {number} [defaultValue] The value used for `undefined` arguments.
         * @returns {Function} Returns the new mathematical operation function.
         */
        function createMathOperation(operator, defaultValue) {
          return function(value, other) {
            var result;
            if (value === undefined$1 && other === undefined$1) {
              return defaultValue;
            }
            if (value !== undefined$1) {
              result = value;
            }
            if (other !== undefined$1) {
              if (result === undefined$1) {
                return other;
              }
              if (typeof value == 'string' || typeof other == 'string') {
                value = baseToString(value);
                other = baseToString(other);
              } else {
                value = baseToNumber(value);
                other = baseToNumber(other);
              }
              result = operator(value, other);
            }
            return result;
          };
        }

        /**
         * Creates a function like `_.over`.
         *
         * @private
         * @param {Function} arrayFunc The function to iterate over iteratees.
         * @returns {Function} Returns the new over function.
         */
        function createOver(arrayFunc) {
          return flatRest(function(iteratees) {
            iteratees = arrayMap(iteratees, baseUnary(getIteratee()));
            return baseRest(function(args) {
              var thisArg = this;
              return arrayFunc(iteratees, function(iteratee) {
                return apply(iteratee, thisArg, args);
              });
            });
          });
        }

        /**
         * Creates the padding for `string` based on `length`. The `chars` string
         * is truncated if the number of characters exceeds `length`.
         *
         * @private
         * @param {number} length The padding length.
         * @param {string} [chars=' '] The string used as padding.
         * @returns {string} Returns the padding for `string`.
         */
        function createPadding(length, chars) {
          chars = chars === undefined$1 ? ' ' : baseToString(chars);

          var charsLength = chars.length;
          if (charsLength < 2) {
            return charsLength ? baseRepeat(chars, length) : chars;
          }
          var result = baseRepeat(chars, nativeCeil(length / stringSize(chars)));
          return hasUnicode(chars)
            ? castSlice(stringToArray(result), 0, length).join('')
            : result.slice(0, length);
        }

        /**
         * Creates a function that wraps `func` to invoke it with the `this` binding
         * of `thisArg` and `partials` prepended to the arguments it receives.
         *
         * @private
         * @param {Function} func The function to wrap.
         * @param {number} bitmask The bitmask flags. See `createWrap` for more details.
         * @param {*} thisArg The `this` binding of `func`.
         * @param {Array} partials The arguments to prepend to those provided to
         *  the new function.
         * @returns {Function} Returns the new wrapped function.
         */
        function createPartial(func, bitmask, thisArg, partials) {
          var isBind = bitmask & WRAP_BIND_FLAG,
              Ctor = createCtor(func);

          function wrapper() {
            var argsIndex = -1,
                argsLength = arguments.length,
                leftIndex = -1,
                leftLength = partials.length,
                args = Array(leftLength + argsLength),
                fn = (this && this !== root && this instanceof wrapper) ? Ctor : func;

            while (++leftIndex < leftLength) {
              args[leftIndex] = partials[leftIndex];
            }
            while (argsLength--) {
              args[leftIndex++] = arguments[++argsIndex];
            }
            return apply(fn, isBind ? thisArg : this, args);
          }
          return wrapper;
        }

        /**
         * Creates a `_.range` or `_.rangeRight` function.
         *
         * @private
         * @param {boolean} [fromRight] Specify iterating from right to left.
         * @returns {Function} Returns the new range function.
         */
        function createRange(fromRight) {
          return function(start, end, step) {
            if (step && typeof step != 'number' && isIterateeCall(start, end, step)) {
              end = step = undefined$1;
            }
            // Ensure the sign of `-0` is preserved.
            start = toFinite(start);
            if (end === undefined$1) {
              end = start;
              start = 0;
            } else {
              end = toFinite(end);
            }
            step = step === undefined$1 ? (start < end ? 1 : -1) : toFinite(step);
            return baseRange(start, end, step, fromRight);
          };
        }

        /**
         * Creates a function that performs a relational operation on two values.
         *
         * @private
         * @param {Function} operator The function to perform the operation.
         * @returns {Function} Returns the new relational operation function.
         */
        function createRelationalOperation(operator) {
          return function(value, other) {
            if (!(typeof value == 'string' && typeof other == 'string')) {
              value = toNumber(value);
              other = toNumber(other);
            }
            return operator(value, other);
          };
        }

        /**
         * Creates a function that wraps `func` to continue currying.
         *
         * @private
         * @param {Function} func The function to wrap.
         * @param {number} bitmask The bitmask flags. See `createWrap` for more details.
         * @param {Function} wrapFunc The function to create the `func` wrapper.
         * @param {*} placeholder The placeholder value.
         * @param {*} [thisArg] The `this` binding of `func`.
         * @param {Array} [partials] The arguments to prepend to those provided to
         *  the new function.
         * @param {Array} [holders] The `partials` placeholder indexes.
         * @param {Array} [argPos] The argument positions of the new function.
         * @param {number} [ary] The arity cap of `func`.
         * @param {number} [arity] The arity of `func`.
         * @returns {Function} Returns the new wrapped function.
         */
        function createRecurry(func, bitmask, wrapFunc, placeholder, thisArg, partials, holders, argPos, ary, arity) {
          var isCurry = bitmask & WRAP_CURRY_FLAG,
              newHolders = isCurry ? holders : undefined$1,
              newHoldersRight = isCurry ? undefined$1 : holders,
              newPartials = isCurry ? partials : undefined$1,
              newPartialsRight = isCurry ? undefined$1 : partials;

          bitmask |= (isCurry ? WRAP_PARTIAL_FLAG : WRAP_PARTIAL_RIGHT_FLAG);
          bitmask &= ~(isCurry ? WRAP_PARTIAL_RIGHT_FLAG : WRAP_PARTIAL_FLAG);

          if (!(bitmask & WRAP_CURRY_BOUND_FLAG)) {
            bitmask &= ~(WRAP_BIND_FLAG | WRAP_BIND_KEY_FLAG);
          }
          var newData = [
            func, bitmask, thisArg, newPartials, newHolders, newPartialsRight,
            newHoldersRight, argPos, ary, arity
          ];

          var result = wrapFunc.apply(undefined$1, newData);
          if (isLaziable(func)) {
            setData(result, newData);
          }
          result.placeholder = placeholder;
          return setWrapToString(result, func, bitmask);
        }

        /**
         * Creates a function like `_.round`.
         *
         * @private
         * @param {string} methodName The name of the `Math` method to use when rounding.
         * @returns {Function} Returns the new round function.
         */
        function createRound(methodName) {
          var func = Math[methodName];
          return function(number, precision) {
            number = toNumber(number);
            precision = precision == null ? 0 : nativeMin(toInteger(precision), 292);
            if (precision && nativeIsFinite(number)) {
              // Shift with exponential notation to avoid floating-point issues.
              // See [MDN](https://mdn.io/round#Examples) for more details.
              var pair = (toString(number) + 'e').split('e'),
                  value = func(pair[0] + 'e' + (+pair[1] + precision));

              pair = (toString(value) + 'e').split('e');
              return +(pair[0] + 'e' + (+pair[1] - precision));
            }
            return func(number);
          };
        }

        /**
         * Creates a set object of `values`.
         *
         * @private
         * @param {Array} values The values to add to the set.
         * @returns {Object} Returns the new set.
         */
        var createSet = !(Set && (1 / setToArray(new Set([,-0]))[1]) == INFINITY) ? noop : function(values) {
          return new Set(values);
        };

        /**
         * Creates a `_.toPairs` or `_.toPairsIn` function.
         *
         * @private
         * @param {Function} keysFunc The function to get the keys of a given object.
         * @returns {Function} Returns the new pairs function.
         */
        function createToPairs(keysFunc) {
          return function(object) {
            var tag = getTag(object);
            if (tag == mapTag) {
              return mapToArray(object);
            }
            if (tag == setTag) {
              return setToPairs(object);
            }
            return baseToPairs(object, keysFunc(object));
          };
        }

        /**
         * Creates a function that either curries or invokes `func` with optional
         * `this` binding and partially applied arguments.
         *
         * @private
         * @param {Function|string} func The function or method name to wrap.
         * @param {number} bitmask The bitmask flags.
         *    1 - `_.bind`
         *    2 - `_.bindKey`
         *    4 - `_.curry` or `_.curryRight` of a bound function
         *    8 - `_.curry`
         *   16 - `_.curryRight`
         *   32 - `_.partial`
         *   64 - `_.partialRight`
         *  128 - `_.rearg`
         *  256 - `_.ary`
         *  512 - `_.flip`
         * @param {*} [thisArg] The `this` binding of `func`.
         * @param {Array} [partials] The arguments to be partially applied.
         * @param {Array} [holders] The `partials` placeholder indexes.
         * @param {Array} [argPos] The argument positions of the new function.
         * @param {number} [ary] The arity cap of `func`.
         * @param {number} [arity] The arity of `func`.
         * @returns {Function} Returns the new wrapped function.
         */
        function createWrap(func, bitmask, thisArg, partials, holders, argPos, ary, arity) {
          var isBindKey = bitmask & WRAP_BIND_KEY_FLAG;
          if (!isBindKey && typeof func != 'function') {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          var length = partials ? partials.length : 0;
          if (!length) {
            bitmask &= ~(WRAP_PARTIAL_FLAG | WRAP_PARTIAL_RIGHT_FLAG);
            partials = holders = undefined$1;
          }
          ary = ary === undefined$1 ? ary : nativeMax(toInteger(ary), 0);
          arity = arity === undefined$1 ? arity : toInteger(arity);
          length -= holders ? holders.length : 0;

          if (bitmask & WRAP_PARTIAL_RIGHT_FLAG) {
            var partialsRight = partials,
                holdersRight = holders;

            partials = holders = undefined$1;
          }
          var data = isBindKey ? undefined$1 : getData(func);

          var newData = [
            func, bitmask, thisArg, partials, holders, partialsRight, holdersRight,
            argPos, ary, arity
          ];

          if (data) {
            mergeData(newData, data);
          }
          func = newData[0];
          bitmask = newData[1];
          thisArg = newData[2];
          partials = newData[3];
          holders = newData[4];
          arity = newData[9] = newData[9] === undefined$1
            ? (isBindKey ? 0 : func.length)
            : nativeMax(newData[9] - length, 0);

          if (!arity && bitmask & (WRAP_CURRY_FLAG | WRAP_CURRY_RIGHT_FLAG)) {
            bitmask &= ~(WRAP_CURRY_FLAG | WRAP_CURRY_RIGHT_FLAG);
          }
          if (!bitmask || bitmask == WRAP_BIND_FLAG) {
            var result = createBind(func, bitmask, thisArg);
          } else if (bitmask == WRAP_CURRY_FLAG || bitmask == WRAP_CURRY_RIGHT_FLAG) {
            result = createCurry(func, bitmask, arity);
          } else if ((bitmask == WRAP_PARTIAL_FLAG || bitmask == (WRAP_BIND_FLAG | WRAP_PARTIAL_FLAG)) && !holders.length) {
            result = createPartial(func, bitmask, thisArg, partials);
          } else {
            result = createHybrid.apply(undefined$1, newData);
          }
          var setter = data ? baseSetData : setData;
          return setWrapToString(setter(result, newData), func, bitmask);
        }

        /**
         * Used by `_.defaults` to customize its `_.assignIn` use to assign properties
         * of source objects to the destination object for all destination properties
         * that resolve to `undefined`.
         *
         * @private
         * @param {*} objValue The destination value.
         * @param {*} srcValue The source value.
         * @param {string} key The key of the property to assign.
         * @param {Object} object The parent object of `objValue`.
         * @returns {*} Returns the value to assign.
         */
        function customDefaultsAssignIn(objValue, srcValue, key, object) {
          if (objValue === undefined$1 ||
              (eq(objValue, objectProto[key]) && !hasOwnProperty.call(object, key))) {
            return srcValue;
          }
          return objValue;
        }

        /**
         * Used by `_.defaultsDeep` to customize its `_.merge` use to merge source
         * objects into destination objects that are passed thru.
         *
         * @private
         * @param {*} objValue The destination value.
         * @param {*} srcValue The source value.
         * @param {string} key The key of the property to merge.
         * @param {Object} object The parent object of `objValue`.
         * @param {Object} source The parent object of `srcValue`.
         * @param {Object} [stack] Tracks traversed source values and their merged
         *  counterparts.
         * @returns {*} Returns the value to assign.
         */
        function customDefaultsMerge(objValue, srcValue, key, object, source, stack) {
          if (isObject(objValue) && isObject(srcValue)) {
            // Recursively merge objects and arrays (susceptible to call stack limits).
            stack.set(srcValue, objValue);
            baseMerge(objValue, srcValue, undefined$1, customDefaultsMerge, stack);
            stack['delete'](srcValue);
          }
          return objValue;
        }

        /**
         * Used by `_.omit` to customize its `_.cloneDeep` use to only clone plain
         * objects.
         *
         * @private
         * @param {*} value The value to inspect.
         * @param {string} key The key of the property to inspect.
         * @returns {*} Returns the uncloned value or `undefined` to defer cloning to `_.cloneDeep`.
         */
        function customOmitClone(value) {
          return isPlainObject(value) ? undefined$1 : value;
        }

        /**
         * A specialized version of `baseIsEqualDeep` for arrays with support for
         * partial deep comparisons.
         *
         * @private
         * @param {Array} array The array to compare.
         * @param {Array} other The other array to compare.
         * @param {number} bitmask The bitmask flags. See `baseIsEqual` for more details.
         * @param {Function} customizer The function to customize comparisons.
         * @param {Function} equalFunc The function to determine equivalents of values.
         * @param {Object} stack Tracks traversed `array` and `other` objects.
         * @returns {boolean} Returns `true` if the arrays are equivalent, else `false`.
         */
        function equalArrays(array, other, bitmask, customizer, equalFunc, stack) {
          var isPartial = bitmask & COMPARE_PARTIAL_FLAG,
              arrLength = array.length,
              othLength = other.length;

          if (arrLength != othLength && !(isPartial && othLength > arrLength)) {
            return false;
          }
          // Check that cyclic values are equal.
          var arrStacked = stack.get(array);
          var othStacked = stack.get(other);
          if (arrStacked && othStacked) {
            return arrStacked == other && othStacked == array;
          }
          var index = -1,
              result = true,
              seen = (bitmask & COMPARE_UNORDERED_FLAG) ? new SetCache : undefined$1;

          stack.set(array, other);
          stack.set(other, array);

          // Ignore non-index properties.
          while (++index < arrLength) {
            var arrValue = array[index],
                othValue = other[index];

            if (customizer) {
              var compared = isPartial
                ? customizer(othValue, arrValue, index, other, array, stack)
                : customizer(arrValue, othValue, index, array, other, stack);
            }
            if (compared !== undefined$1) {
              if (compared) {
                continue;
              }
              result = false;
              break;
            }
            // Recursively compare arrays (susceptible to call stack limits).
            if (seen) {
              if (!arraySome(other, function(othValue, othIndex) {
                    if (!cacheHas(seen, othIndex) &&
                        (arrValue === othValue || equalFunc(arrValue, othValue, bitmask, customizer, stack))) {
                      return seen.push(othIndex);
                    }
                  })) {
                result = false;
                break;
              }
            } else if (!(
                  arrValue === othValue ||
                    equalFunc(arrValue, othValue, bitmask, customizer, stack)
                )) {
              result = false;
              break;
            }
          }
          stack['delete'](array);
          stack['delete'](other);
          return result;
        }

        /**
         * A specialized version of `baseIsEqualDeep` for comparing objects of
         * the same `toStringTag`.
         *
         * **Note:** This function only supports comparing values with tags of
         * `Boolean`, `Date`, `Error`, `Number`, `RegExp`, or `String`.
         *
         * @private
         * @param {Object} object The object to compare.
         * @param {Object} other The other object to compare.
         * @param {string} tag The `toStringTag` of the objects to compare.
         * @param {number} bitmask The bitmask flags. See `baseIsEqual` for more details.
         * @param {Function} customizer The function to customize comparisons.
         * @param {Function} equalFunc The function to determine equivalents of values.
         * @param {Object} stack Tracks traversed `object` and `other` objects.
         * @returns {boolean} Returns `true` if the objects are equivalent, else `false`.
         */
        function equalByTag(object, other, tag, bitmask, customizer, equalFunc, stack) {
          switch (tag) {
            case dataViewTag:
              if ((object.byteLength != other.byteLength) ||
                  (object.byteOffset != other.byteOffset)) {
                return false;
              }
              object = object.buffer;
              other = other.buffer;

            case arrayBufferTag:
              if ((object.byteLength != other.byteLength) ||
                  !equalFunc(new Uint8Array(object), new Uint8Array(other))) {
                return false;
              }
              return true;

            case boolTag:
            case dateTag:
            case numberTag:
              // Coerce booleans to `1` or `0` and dates to milliseconds.
              // Invalid dates are coerced to `NaN`.
              return eq(+object, +other);

            case errorTag:
              return object.name == other.name && object.message == other.message;

            case regexpTag:
            case stringTag:
              // Coerce regexes to strings and treat strings, primitives and objects,
              // as equal. See http://www.ecma-international.org/ecma-262/7.0/#sec-regexp.prototype.tostring
              // for more details.
              return object == (other + '');

            case mapTag:
              var convert = mapToArray;

            case setTag:
              var isPartial = bitmask & COMPARE_PARTIAL_FLAG;
              convert || (convert = setToArray);

              if (object.size != other.size && !isPartial) {
                return false;
              }
              // Assume cyclic values are equal.
              var stacked = stack.get(object);
              if (stacked) {
                return stacked == other;
              }
              bitmask |= COMPARE_UNORDERED_FLAG;

              // Recursively compare objects (susceptible to call stack limits).
              stack.set(object, other);
              var result = equalArrays(convert(object), convert(other), bitmask, customizer, equalFunc, stack);
              stack['delete'](object);
              return result;

            case symbolTag:
              if (symbolValueOf) {
                return symbolValueOf.call(object) == symbolValueOf.call(other);
              }
          }
          return false;
        }

        /**
         * A specialized version of `baseIsEqualDeep` for objects with support for
         * partial deep comparisons.
         *
         * @private
         * @param {Object} object The object to compare.
         * @param {Object} other The other object to compare.
         * @param {number} bitmask The bitmask flags. See `baseIsEqual` for more details.
         * @param {Function} customizer The function to customize comparisons.
         * @param {Function} equalFunc The function to determine equivalents of values.
         * @param {Object} stack Tracks traversed `object` and `other` objects.
         * @returns {boolean} Returns `true` if the objects are equivalent, else `false`.
         */
        function equalObjects(object, other, bitmask, customizer, equalFunc, stack) {
          var isPartial = bitmask & COMPARE_PARTIAL_FLAG,
              objProps = getAllKeys(object),
              objLength = objProps.length,
              othProps = getAllKeys(other),
              othLength = othProps.length;

          if (objLength != othLength && !isPartial) {
            return false;
          }
          var index = objLength;
          while (index--) {
            var key = objProps[index];
            if (!(isPartial ? key in other : hasOwnProperty.call(other, key))) {
              return false;
            }
          }
          // Check that cyclic values are equal.
          var objStacked = stack.get(object);
          var othStacked = stack.get(other);
          if (objStacked && othStacked) {
            return objStacked == other && othStacked == object;
          }
          var result = true;
          stack.set(object, other);
          stack.set(other, object);

          var skipCtor = isPartial;
          while (++index < objLength) {
            key = objProps[index];
            var objValue = object[key],
                othValue = other[key];

            if (customizer) {
              var compared = isPartial
                ? customizer(othValue, objValue, key, other, object, stack)
                : customizer(objValue, othValue, key, object, other, stack);
            }
            // Recursively compare objects (susceptible to call stack limits).
            if (!(compared === undefined$1
                  ? (objValue === othValue || equalFunc(objValue, othValue, bitmask, customizer, stack))
                  : compared
                )) {
              result = false;
              break;
            }
            skipCtor || (skipCtor = key == 'constructor');
          }
          if (result && !skipCtor) {
            var objCtor = object.constructor,
                othCtor = other.constructor;

            // Non `Object` object instances with different constructors are not equal.
            if (objCtor != othCtor &&
                ('constructor' in object && 'constructor' in other) &&
                !(typeof objCtor == 'function' && objCtor instanceof objCtor &&
                  typeof othCtor == 'function' && othCtor instanceof othCtor)) {
              result = false;
            }
          }
          stack['delete'](object);
          stack['delete'](other);
          return result;
        }

        /**
         * A specialized version of `baseRest` which flattens the rest array.
         *
         * @private
         * @param {Function} func The function to apply a rest parameter to.
         * @returns {Function} Returns the new function.
         */
        function flatRest(func) {
          return setToString(overRest(func, undefined$1, flatten), func + '');
        }

        /**
         * Creates an array of own enumerable property names and symbols of `object`.
         *
         * @private
         * @param {Object} object The object to query.
         * @returns {Array} Returns the array of property names and symbols.
         */
        function getAllKeys(object) {
          return baseGetAllKeys(object, keys, getSymbols);
        }

        /**
         * Creates an array of own and inherited enumerable property names and
         * symbols of `object`.
         *
         * @private
         * @param {Object} object The object to query.
         * @returns {Array} Returns the array of property names and symbols.
         */
        function getAllKeysIn(object) {
          return baseGetAllKeys(object, keysIn, getSymbolsIn);
        }

        /**
         * Gets metadata for `func`.
         *
         * @private
         * @param {Function} func The function to query.
         * @returns {*} Returns the metadata for `func`.
         */
        var getData = !metaMap ? noop : function(func) {
          return metaMap.get(func);
        };

        /**
         * Gets the name of `func`.
         *
         * @private
         * @param {Function} func The function to query.
         * @returns {string} Returns the function name.
         */
        function getFuncName(func) {
          var result = (func.name + ''),
              array = realNames[result],
              length = hasOwnProperty.call(realNames, result) ? array.length : 0;

          while (length--) {
            var data = array[length],
                otherFunc = data.func;
            if (otherFunc == null || otherFunc == func) {
              return data.name;
            }
          }
          return result;
        }

        /**
         * Gets the argument placeholder value for `func`.
         *
         * @private
         * @param {Function} func The function to inspect.
         * @returns {*} Returns the placeholder value.
         */
        function getHolder(func) {
          var object = hasOwnProperty.call(lodash, 'placeholder') ? lodash : func;
          return object.placeholder;
        }

        /**
         * Gets the appropriate "iteratee" function. If `_.iteratee` is customized,
         * this function returns the custom method, otherwise it returns `baseIteratee`.
         * If arguments are provided, the chosen function is invoked with them and
         * its result is returned.
         *
         * @private
         * @param {*} [value] The value to convert to an iteratee.
         * @param {number} [arity] The arity of the created iteratee.
         * @returns {Function} Returns the chosen function or its result.
         */
        function getIteratee() {
          var result = lodash.iteratee || iteratee;
          result = result === iteratee ? baseIteratee : result;
          return arguments.length ? result(arguments[0], arguments[1]) : result;
        }

        /**
         * Gets the data for `map`.
         *
         * @private
         * @param {Object} map The map to query.
         * @param {string} key The reference key.
         * @returns {*} Returns the map data.
         */
        function getMapData(map, key) {
          var data = map.__data__;
          return isKeyable(key)
            ? data[typeof key == 'string' ? 'string' : 'hash']
            : data.map;
        }

        /**
         * Gets the property names, values, and compare flags of `object`.
         *
         * @private
         * @param {Object} object The object to query.
         * @returns {Array} Returns the match data of `object`.
         */
        function getMatchData(object) {
          var result = keys(object),
              length = result.length;

          while (length--) {
            var key = result[length],
                value = object[key];

            result[length] = [key, value, isStrictComparable(value)];
          }
          return result;
        }

        /**
         * Gets the native function at `key` of `object`.
         *
         * @private
         * @param {Object} object The object to query.
         * @param {string} key The key of the method to get.
         * @returns {*} Returns the function if it's native, else `undefined`.
         */
        function getNative(object, key) {
          var value = getValue(object, key);
          return baseIsNative(value) ? value : undefined$1;
        }

        /**
         * A specialized version of `baseGetTag` which ignores `Symbol.toStringTag` values.
         *
         * @private
         * @param {*} value The value to query.
         * @returns {string} Returns the raw `toStringTag`.
         */
        function getRawTag(value) {
          var isOwn = hasOwnProperty.call(value, symToStringTag),
              tag = value[symToStringTag];

          try {
            value[symToStringTag] = undefined$1;
            var unmasked = true;
          } catch (e) {}

          var result = nativeObjectToString.call(value);
          if (unmasked) {
            if (isOwn) {
              value[symToStringTag] = tag;
            } else {
              delete value[symToStringTag];
            }
          }
          return result;
        }

        /**
         * Creates an array of the own enumerable symbols of `object`.
         *
         * @private
         * @param {Object} object The object to query.
         * @returns {Array} Returns the array of symbols.
         */
        var getSymbols = !nativeGetSymbols ? stubArray : function(object) {
          if (object == null) {
            return [];
          }
          object = Object(object);
          return arrayFilter(nativeGetSymbols(object), function(symbol) {
            return propertyIsEnumerable.call(object, symbol);
          });
        };

        /**
         * Creates an array of the own and inherited enumerable symbols of `object`.
         *
         * @private
         * @param {Object} object The object to query.
         * @returns {Array} Returns the array of symbols.
         */
        var getSymbolsIn = !nativeGetSymbols ? stubArray : function(object) {
          var result = [];
          while (object) {
            arrayPush(result, getSymbols(object));
            object = getPrototype(object);
          }
          return result;
        };

        /**
         * Gets the `toStringTag` of `value`.
         *
         * @private
         * @param {*} value The value to query.
         * @returns {string} Returns the `toStringTag`.
         */
        var getTag = baseGetTag;

        // Fallback for data views, maps, sets, and weak maps in IE 11 and promises in Node.js < 6.
        if ((DataView && getTag(new DataView(new ArrayBuffer(1))) != dataViewTag) ||
            (Map && getTag(new Map) != mapTag) ||
            (Promise && getTag(Promise.resolve()) != promiseTag) ||
            (Set && getTag(new Set) != setTag) ||
            (WeakMap && getTag(new WeakMap) != weakMapTag)) {
          getTag = function(value) {
            var result = baseGetTag(value),
                Ctor = result == objectTag ? value.constructor : undefined$1,
                ctorString = Ctor ? toSource(Ctor) : '';

            if (ctorString) {
              switch (ctorString) {
                case dataViewCtorString: return dataViewTag;
                case mapCtorString: return mapTag;
                case promiseCtorString: return promiseTag;
                case setCtorString: return setTag;
                case weakMapCtorString: return weakMapTag;
              }
            }
            return result;
          };
        }

        /**
         * Gets the view, applying any `transforms` to the `start` and `end` positions.
         *
         * @private
         * @param {number} start The start of the view.
         * @param {number} end The end of the view.
         * @param {Array} transforms The transformations to apply to the view.
         * @returns {Object} Returns an object containing the `start` and `end`
         *  positions of the view.
         */
        function getView(start, end, transforms) {
          var index = -1,
              length = transforms.length;

          while (++index < length) {
            var data = transforms[index],
                size = data.size;

            switch (data.type) {
              case 'drop':      start += size; break;
              case 'dropRight': end -= size; break;
              case 'take':      end = nativeMin(end, start + size); break;
              case 'takeRight': start = nativeMax(start, end - size); break;
            }
          }
          return { 'start': start, 'end': end };
        }

        /**
         * Extracts wrapper details from the `source` body comment.
         *
         * @private
         * @param {string} source The source to inspect.
         * @returns {Array} Returns the wrapper details.
         */
        function getWrapDetails(source) {
          var match = source.match(reWrapDetails);
          return match ? match[1].split(reSplitDetails) : [];
        }

        /**
         * Checks if `path` exists on `object`.
         *
         * @private
         * @param {Object} object The object to query.
         * @param {Array|string} path The path to check.
         * @param {Function} hasFunc The function to check properties.
         * @returns {boolean} Returns `true` if `path` exists, else `false`.
         */
        function hasPath(object, path, hasFunc) {
          path = castPath(path, object);

          var index = -1,
              length = path.length,
              result = false;

          while (++index < length) {
            var key = toKey(path[index]);
            if (!(result = object != null && hasFunc(object, key))) {
              break;
            }
            object = object[key];
          }
          if (result || ++index != length) {
            return result;
          }
          length = object == null ? 0 : object.length;
          return !!length && isLength(length) && isIndex(key, length) &&
            (isArray(object) || isArguments(object));
        }

        /**
         * Initializes an array clone.
         *
         * @private
         * @param {Array} array The array to clone.
         * @returns {Array} Returns the initialized clone.
         */
        function initCloneArray(array) {
          var length = array.length,
              result = new array.constructor(length);

          // Add properties assigned by `RegExp#exec`.
          if (length && typeof array[0] == 'string' && hasOwnProperty.call(array, 'index')) {
            result.index = array.index;
            result.input = array.input;
          }
          return result;
        }

        /**
         * Initializes an object clone.
         *
         * @private
         * @param {Object} object The object to clone.
         * @returns {Object} Returns the initialized clone.
         */
        function initCloneObject(object) {
          return (typeof object.constructor == 'function' && !isPrototype(object))
            ? baseCreate(getPrototype(object))
            : {};
        }

        /**
         * Initializes an object clone based on its `toStringTag`.
         *
         * **Note:** This function only supports cloning values with tags of
         * `Boolean`, `Date`, `Error`, `Map`, `Number`, `RegExp`, `Set`, or `String`.
         *
         * @private
         * @param {Object} object The object to clone.
         * @param {string} tag The `toStringTag` of the object to clone.
         * @param {boolean} [isDeep] Specify a deep clone.
         * @returns {Object} Returns the initialized clone.
         */
        function initCloneByTag(object, tag, isDeep) {
          var Ctor = object.constructor;
          switch (tag) {
            case arrayBufferTag:
              return cloneArrayBuffer(object);

            case boolTag:
            case dateTag:
              return new Ctor(+object);

            case dataViewTag:
              return cloneDataView(object, isDeep);

            case float32Tag: case float64Tag:
            case int8Tag: case int16Tag: case int32Tag:
            case uint8Tag: case uint8ClampedTag: case uint16Tag: case uint32Tag:
              return cloneTypedArray(object, isDeep);

            case mapTag:
              return new Ctor;

            case numberTag:
            case stringTag:
              return new Ctor(object);

            case regexpTag:
              return cloneRegExp(object);

            case setTag:
              return new Ctor;

            case symbolTag:
              return cloneSymbol(object);
          }
        }

        /**
         * Inserts wrapper `details` in a comment at the top of the `source` body.
         *
         * @private
         * @param {string} source The source to modify.
         * @returns {Array} details The details to insert.
         * @returns {string} Returns the modified source.
         */
        function insertWrapDetails(source, details) {
          var length = details.length;
          if (!length) {
            return source;
          }
          var lastIndex = length - 1;
          details[lastIndex] = (length > 1 ? '& ' : '') + details[lastIndex];
          details = details.join(length > 2 ? ', ' : ' ');
          return source.replace(reWrapComment, '{\n/* [wrapped with ' + details + '] */\n');
        }

        /**
         * Checks if `value` is a flattenable `arguments` object or array.
         *
         * @private
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is flattenable, else `false`.
         */
        function isFlattenable(value) {
          return isArray(value) || isArguments(value) ||
            !!(spreadableSymbol && value && value[spreadableSymbol]);
        }

        /**
         * Checks if `value` is a valid array-like index.
         *
         * @private
         * @param {*} value The value to check.
         * @param {number} [length=MAX_SAFE_INTEGER] The upper bounds of a valid index.
         * @returns {boolean} Returns `true` if `value` is a valid index, else `false`.
         */
        function isIndex(value, length) {
          var type = typeof value;
          length = length == null ? MAX_SAFE_INTEGER : length;

          return !!length &&
            (type == 'number' ||
              (type != 'symbol' && reIsUint.test(value))) &&
                (value > -1 && value % 1 == 0 && value < length);
        }

        /**
         * Checks if the given arguments are from an iteratee call.
         *
         * @private
         * @param {*} value The potential iteratee value argument.
         * @param {*} index The potential iteratee index or key argument.
         * @param {*} object The potential iteratee object argument.
         * @returns {boolean} Returns `true` if the arguments are from an iteratee call,
         *  else `false`.
         */
        function isIterateeCall(value, index, object) {
          if (!isObject(object)) {
            return false;
          }
          var type = typeof index;
          if (type == 'number'
                ? (isArrayLike(object) && isIndex(index, object.length))
                : (type == 'string' && index in object)
              ) {
            return eq(object[index], value);
          }
          return false;
        }

        /**
         * Checks if `value` is a property name and not a property path.
         *
         * @private
         * @param {*} value The value to check.
         * @param {Object} [object] The object to query keys on.
         * @returns {boolean} Returns `true` if `value` is a property name, else `false`.
         */
        function isKey(value, object) {
          if (isArray(value)) {
            return false;
          }
          var type = typeof value;
          if (type == 'number' || type == 'symbol' || type == 'boolean' ||
              value == null || isSymbol(value)) {
            return true;
          }
          return reIsPlainProp.test(value) || !reIsDeepProp.test(value) ||
            (object != null && value in Object(object));
        }

        /**
         * Checks if `value` is suitable for use as unique object key.
         *
         * @private
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is suitable, else `false`.
         */
        function isKeyable(value) {
          var type = typeof value;
          return (type == 'string' || type == 'number' || type == 'symbol' || type == 'boolean')
            ? (value !== '__proto__')
            : (value === null);
        }

        /**
         * Checks if `func` has a lazy counterpart.
         *
         * @private
         * @param {Function} func The function to check.
         * @returns {boolean} Returns `true` if `func` has a lazy counterpart,
         *  else `false`.
         */
        function isLaziable(func) {
          var funcName = getFuncName(func),
              other = lodash[funcName];

          if (typeof other != 'function' || !(funcName in LazyWrapper.prototype)) {
            return false;
          }
          if (func === other) {
            return true;
          }
          var data = getData(other);
          return !!data && func === data[0];
        }

        /**
         * Checks if `func` has its source masked.
         *
         * @private
         * @param {Function} func The function to check.
         * @returns {boolean} Returns `true` if `func` is masked, else `false`.
         */
        function isMasked(func) {
          return !!maskSrcKey && (maskSrcKey in func);
        }

        /**
         * Checks if `func` is capable of being masked.
         *
         * @private
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `func` is maskable, else `false`.
         */
        var isMaskable = coreJsData ? isFunction : stubFalse;

        /**
         * Checks if `value` is likely a prototype object.
         *
         * @private
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a prototype, else `false`.
         */
        function isPrototype(value) {
          var Ctor = value && value.constructor,
              proto = (typeof Ctor == 'function' && Ctor.prototype) || objectProto;

          return value === proto;
        }

        /**
         * Checks if `value` is suitable for strict equality comparisons, i.e. `===`.
         *
         * @private
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` if suitable for strict
         *  equality comparisons, else `false`.
         */
        function isStrictComparable(value) {
          return value === value && !isObject(value);
        }

        /**
         * A specialized version of `matchesProperty` for source values suitable
         * for strict equality comparisons, i.e. `===`.
         *
         * @private
         * @param {string} key The key of the property to get.
         * @param {*} srcValue The value to match.
         * @returns {Function} Returns the new spec function.
         */
        function matchesStrictComparable(key, srcValue) {
          return function(object) {
            if (object == null) {
              return false;
            }
            return object[key] === srcValue &&
              (srcValue !== undefined$1 || (key in Object(object)));
          };
        }

        /**
         * A specialized version of `_.memoize` which clears the memoized function's
         * cache when it exceeds `MAX_MEMOIZE_SIZE`.
         *
         * @private
         * @param {Function} func The function to have its output memoized.
         * @returns {Function} Returns the new memoized function.
         */
        function memoizeCapped(func) {
          var result = memoize(func, function(key) {
            if (cache.size === MAX_MEMOIZE_SIZE) {
              cache.clear();
            }
            return key;
          });

          var cache = result.cache;
          return result;
        }

        /**
         * Merges the function metadata of `source` into `data`.
         *
         * Merging metadata reduces the number of wrappers used to invoke a function.
         * This is possible because methods like `_.bind`, `_.curry`, and `_.partial`
         * may be applied regardless of execution order. Methods like `_.ary` and
         * `_.rearg` modify function arguments, making the order in which they are
         * executed important, preventing the merging of metadata. However, we make
         * an exception for a safe combined case where curried functions have `_.ary`
         * and or `_.rearg` applied.
         *
         * @private
         * @param {Array} data The destination metadata.
         * @param {Array} source The source metadata.
         * @returns {Array} Returns `data`.
         */
        function mergeData(data, source) {
          var bitmask = data[1],
              srcBitmask = source[1],
              newBitmask = bitmask | srcBitmask,
              isCommon = newBitmask < (WRAP_BIND_FLAG | WRAP_BIND_KEY_FLAG | WRAP_ARY_FLAG);

          var isCombo =
            ((srcBitmask == WRAP_ARY_FLAG) && (bitmask == WRAP_CURRY_FLAG)) ||
            ((srcBitmask == WRAP_ARY_FLAG) && (bitmask == WRAP_REARG_FLAG) && (data[7].length <= source[8])) ||
            ((srcBitmask == (WRAP_ARY_FLAG | WRAP_REARG_FLAG)) && (source[7].length <= source[8]) && (bitmask == WRAP_CURRY_FLAG));

          // Exit early if metadata can't be merged.
          if (!(isCommon || isCombo)) {
            return data;
          }
          // Use source `thisArg` if available.
          if (srcBitmask & WRAP_BIND_FLAG) {
            data[2] = source[2];
            // Set when currying a bound function.
            newBitmask |= bitmask & WRAP_BIND_FLAG ? 0 : WRAP_CURRY_BOUND_FLAG;
          }
          // Compose partial arguments.
          var value = source[3];
          if (value) {
            var partials = data[3];
            data[3] = partials ? composeArgs(partials, value, source[4]) : value;
            data[4] = partials ? replaceHolders(data[3], PLACEHOLDER) : source[4];
          }
          // Compose partial right arguments.
          value = source[5];
          if (value) {
            partials = data[5];
            data[5] = partials ? composeArgsRight(partials, value, source[6]) : value;
            data[6] = partials ? replaceHolders(data[5], PLACEHOLDER) : source[6];
          }
          // Use source `argPos` if available.
          value = source[7];
          if (value) {
            data[7] = value;
          }
          // Use source `ary` if it's smaller.
          if (srcBitmask & WRAP_ARY_FLAG) {
            data[8] = data[8] == null ? source[8] : nativeMin(data[8], source[8]);
          }
          // Use source `arity` if one is not provided.
          if (data[9] == null) {
            data[9] = source[9];
          }
          // Use source `func` and merge bitmasks.
          data[0] = source[0];
          data[1] = newBitmask;

          return data;
        }

        /**
         * This function is like
         * [`Object.keys`](http://ecma-international.org/ecma-262/7.0/#sec-object.keys)
         * except that it includes inherited enumerable properties.
         *
         * @private
         * @param {Object} object The object to query.
         * @returns {Array} Returns the array of property names.
         */
        function nativeKeysIn(object) {
          var result = [];
          if (object != null) {
            for (var key in Object(object)) {
              result.push(key);
            }
          }
          return result;
        }

        /**
         * Converts `value` to a string using `Object.prototype.toString`.
         *
         * @private
         * @param {*} value The value to convert.
         * @returns {string} Returns the converted string.
         */
        function objectToString(value) {
          return nativeObjectToString.call(value);
        }

        /**
         * A specialized version of `baseRest` which transforms the rest array.
         *
         * @private
         * @param {Function} func The function to apply a rest parameter to.
         * @param {number} [start=func.length-1] The start position of the rest parameter.
         * @param {Function} transform The rest array transform.
         * @returns {Function} Returns the new function.
         */
        function overRest(func, start, transform) {
          start = nativeMax(start === undefined$1 ? (func.length - 1) : start, 0);
          return function() {
            var args = arguments,
                index = -1,
                length = nativeMax(args.length - start, 0),
                array = Array(length);

            while (++index < length) {
              array[index] = args[start + index];
            }
            index = -1;
            var otherArgs = Array(start + 1);
            while (++index < start) {
              otherArgs[index] = args[index];
            }
            otherArgs[start] = transform(array);
            return apply(func, this, otherArgs);
          };
        }

        /**
         * Gets the parent value at `path` of `object`.
         *
         * @private
         * @param {Object} object The object to query.
         * @param {Array} path The path to get the parent value of.
         * @returns {*} Returns the parent value.
         */
        function parent(object, path) {
          return path.length < 2 ? object : baseGet(object, baseSlice(path, 0, -1));
        }

        /**
         * Reorder `array` according to the specified indexes where the element at
         * the first index is assigned as the first element, the element at
         * the second index is assigned as the second element, and so on.
         *
         * @private
         * @param {Array} array The array to reorder.
         * @param {Array} indexes The arranged array indexes.
         * @returns {Array} Returns `array`.
         */
        function reorder(array, indexes) {
          var arrLength = array.length,
              length = nativeMin(indexes.length, arrLength),
              oldArray = copyArray(array);

          while (length--) {
            var index = indexes[length];
            array[length] = isIndex(index, arrLength) ? oldArray[index] : undefined$1;
          }
          return array;
        }

        /**
         * Gets the value at `key`, unless `key` is "__proto__" or "constructor".
         *
         * @private
         * @param {Object} object The object to query.
         * @param {string} key The key of the property to get.
         * @returns {*} Returns the property value.
         */
        function safeGet(object, key) {
          if (key === 'constructor' && typeof object[key] === 'function') {
            return;
          }

          if (key == '__proto__') {
            return;
          }

          return object[key];
        }

        /**
         * Sets metadata for `func`.
         *
         * **Note:** If this function becomes hot, i.e. is invoked a lot in a short
         * period of time, it will trip its breaker and transition to an identity
         * function to avoid garbage collection pauses in V8. See
         * [V8 issue 2070](https://bugs.chromium.org/p/v8/issues/detail?id=2070)
         * for more details.
         *
         * @private
         * @param {Function} func The function to associate metadata with.
         * @param {*} data The metadata.
         * @returns {Function} Returns `func`.
         */
        var setData = shortOut(baseSetData);

        /**
         * A simple wrapper around the global [`setTimeout`](https://mdn.io/setTimeout).
         *
         * @private
         * @param {Function} func The function to delay.
         * @param {number} wait The number of milliseconds to delay invocation.
         * @returns {number|Object} Returns the timer id or timeout object.
         */
        var setTimeout = ctxSetTimeout || function(func, wait) {
          return root.setTimeout(func, wait);
        };

        /**
         * Sets the `toString` method of `func` to return `string`.
         *
         * @private
         * @param {Function} func The function to modify.
         * @param {Function} string The `toString` result.
         * @returns {Function} Returns `func`.
         */
        var setToString = shortOut(baseSetToString);

        /**
         * Sets the `toString` method of `wrapper` to mimic the source of `reference`
         * with wrapper details in a comment at the top of the source body.
         *
         * @private
         * @param {Function} wrapper The function to modify.
         * @param {Function} reference The reference function.
         * @param {number} bitmask The bitmask flags. See `createWrap` for more details.
         * @returns {Function} Returns `wrapper`.
         */
        function setWrapToString(wrapper, reference, bitmask) {
          var source = (reference + '');
          return setToString(wrapper, insertWrapDetails(source, updateWrapDetails(getWrapDetails(source), bitmask)));
        }

        /**
         * Creates a function that'll short out and invoke `identity` instead
         * of `func` when it's called `HOT_COUNT` or more times in `HOT_SPAN`
         * milliseconds.
         *
         * @private
         * @param {Function} func The function to restrict.
         * @returns {Function} Returns the new shortable function.
         */
        function shortOut(func) {
          var count = 0,
              lastCalled = 0;

          return function() {
            var stamp = nativeNow(),
                remaining = HOT_SPAN - (stamp - lastCalled);

            lastCalled = stamp;
            if (remaining > 0) {
              if (++count >= HOT_COUNT) {
                return arguments[0];
              }
            } else {
              count = 0;
            }
            return func.apply(undefined$1, arguments);
          };
        }

        /**
         * A specialized version of `_.shuffle` which mutates and sets the size of `array`.
         *
         * @private
         * @param {Array} array The array to shuffle.
         * @param {number} [size=array.length] The size of `array`.
         * @returns {Array} Returns `array`.
         */
        function shuffleSelf(array, size) {
          var index = -1,
              length = array.length,
              lastIndex = length - 1;

          size = size === undefined$1 ? length : size;
          while (++index < size) {
            var rand = baseRandom(index, lastIndex),
                value = array[rand];

            array[rand] = array[index];
            array[index] = value;
          }
          array.length = size;
          return array;
        }

        /**
         * Converts `string` to a property path array.
         *
         * @private
         * @param {string} string The string to convert.
         * @returns {Array} Returns the property path array.
         */
        var stringToPath = memoizeCapped(function(string) {
          var result = [];
          if (string.charCodeAt(0) === 46 /* . */) {
            result.push('');
          }
          string.replace(rePropName, function(match, number, quote, subString) {
            result.push(quote ? subString.replace(reEscapeChar, '$1') : (number || match));
          });
          return result;
        });

        /**
         * Converts `value` to a string key if it's not a string or symbol.
         *
         * @private
         * @param {*} value The value to inspect.
         * @returns {string|symbol} Returns the key.
         */
        function toKey(value) {
          if (typeof value == 'string' || isSymbol(value)) {
            return value;
          }
          var result = (value + '');
          return (result == '0' && (1 / value) == -INFINITY) ? '-0' : result;
        }

        /**
         * Converts `func` to its source code.
         *
         * @private
         * @param {Function} func The function to convert.
         * @returns {string} Returns the source code.
         */
        function toSource(func) {
          if (func != null) {
            try {
              return funcToString.call(func);
            } catch (e) {}
            try {
              return (func + '');
            } catch (e) {}
          }
          return '';
        }

        /**
         * Updates wrapper `details` based on `bitmask` flags.
         *
         * @private
         * @returns {Array} details The details to modify.
         * @param {number} bitmask The bitmask flags. See `createWrap` for more details.
         * @returns {Array} Returns `details`.
         */
        function updateWrapDetails(details, bitmask) {
          arrayEach(wrapFlags, function(pair) {
            var value = '_.' + pair[0];
            if ((bitmask & pair[1]) && !arrayIncludes(details, value)) {
              details.push(value);
            }
          });
          return details.sort();
        }

        /**
         * Creates a clone of `wrapper`.
         *
         * @private
         * @param {Object} wrapper The wrapper to clone.
         * @returns {Object} Returns the cloned wrapper.
         */
        function wrapperClone(wrapper) {
          if (wrapper instanceof LazyWrapper) {
            return wrapper.clone();
          }
          var result = new LodashWrapper(wrapper.__wrapped__, wrapper.__chain__);
          result.__actions__ = copyArray(wrapper.__actions__);
          result.__index__  = wrapper.__index__;
          result.__values__ = wrapper.__values__;
          return result;
        }

        /*------------------------------------------------------------------------*/

        /**
         * Creates an array of elements split into groups the length of `size`.
         * If `array` can't be split evenly, the final chunk will be the remaining
         * elements.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Array
         * @param {Array} array The array to process.
         * @param {number} [size=1] The length of each chunk
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {Array} Returns the new array of chunks.
         * @example
         *
         * _.chunk(['a', 'b', 'c', 'd'], 2);
         * // => [['a', 'b'], ['c', 'd']]
         *
         * _.chunk(['a', 'b', 'c', 'd'], 3);
         * // => [['a', 'b', 'c'], ['d']]
         */
        function chunk(array, size, guard) {
          if ((guard ? isIterateeCall(array, size, guard) : size === undefined$1)) {
            size = 1;
          } else {
            size = nativeMax(toInteger(size), 0);
          }
          var length = array == null ? 0 : array.length;
          if (!length || size < 1) {
            return [];
          }
          var index = 0,
              resIndex = 0,
              result = Array(nativeCeil(length / size));

          while (index < length) {
            result[resIndex++] = baseSlice(array, index, (index += size));
          }
          return result;
        }

        /**
         * Creates an array with all falsey values removed. The values `false`, `null`,
         * `0`, `""`, `undefined`, and `NaN` are falsey.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Array
         * @param {Array} array The array to compact.
         * @returns {Array} Returns the new array of filtered values.
         * @example
         *
         * _.compact([0, 1, false, 2, '', 3]);
         * // => [1, 2, 3]
         */
        function compact(array) {
          var index = -1,
              length = array == null ? 0 : array.length,
              resIndex = 0,
              result = [];

          while (++index < length) {
            var value = array[index];
            if (value) {
              result[resIndex++] = value;
            }
          }
          return result;
        }

        /**
         * Creates a new array concatenating `array` with any additional arrays
         * and/or values.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} array The array to concatenate.
         * @param {...*} [values] The values to concatenate.
         * @returns {Array} Returns the new concatenated array.
         * @example
         *
         * var array = [1];
         * var other = _.concat(array, 2, [3], [[4]]);
         *
         * console.log(other);
         * // => [1, 2, 3, [4]]
         *
         * console.log(array);
         * // => [1]
         */
        function concat() {
          var length = arguments.length;
          if (!length) {
            return [];
          }
          var args = Array(length - 1),
              array = arguments[0],
              index = length;

          while (index--) {
            args[index - 1] = arguments[index];
          }
          return arrayPush(isArray(array) ? copyArray(array) : [array], baseFlatten(args, 1));
        }

        /**
         * Creates an array of `array` values not included in the other given arrays
         * using [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
         * for equality comparisons. The order and references of result values are
         * determined by the first array.
         *
         * **Note:** Unlike `_.pullAll`, this method returns a new array.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Array
         * @param {Array} array The array to inspect.
         * @param {...Array} [values] The values to exclude.
         * @returns {Array} Returns the new array of filtered values.
         * @see _.without, _.xor
         * @example
         *
         * _.difference([2, 1], [2, 3]);
         * // => [1]
         */
        var difference = baseRest(function(array, values) {
          return isArrayLikeObject(array)
            ? baseDifference(array, baseFlatten(values, 1, isArrayLikeObject, true))
            : [];
        });

        /**
         * This method is like `_.difference` except that it accepts `iteratee` which
         * is invoked for each element of `array` and `values` to generate the criterion
         * by which they're compared. The order and references of result values are
         * determined by the first array. The iteratee is invoked with one argument:
         * (value).
         *
         * **Note:** Unlike `_.pullAllBy`, this method returns a new array.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} array The array to inspect.
         * @param {...Array} [values] The values to exclude.
         * @param {Function} [iteratee=_.identity] The iteratee invoked per element.
         * @returns {Array} Returns the new array of filtered values.
         * @example
         *
         * _.differenceBy([2.1, 1.2], [2.3, 3.4], Math.floor);
         * // => [1.2]
         *
         * // The `_.property` iteratee shorthand.
         * _.differenceBy([{ 'x': 2 }, { 'x': 1 }], [{ 'x': 1 }], 'x');
         * // => [{ 'x': 2 }]
         */
        var differenceBy = baseRest(function(array, values) {
          var iteratee = last(values);
          if (isArrayLikeObject(iteratee)) {
            iteratee = undefined$1;
          }
          return isArrayLikeObject(array)
            ? baseDifference(array, baseFlatten(values, 1, isArrayLikeObject, true), getIteratee(iteratee, 2))
            : [];
        });

        /**
         * This method is like `_.difference` except that it accepts `comparator`
         * which is invoked to compare elements of `array` to `values`. The order and
         * references of result values are determined by the first array. The comparator
         * is invoked with two arguments: (arrVal, othVal).
         *
         * **Note:** Unlike `_.pullAllWith`, this method returns a new array.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} array The array to inspect.
         * @param {...Array} [values] The values to exclude.
         * @param {Function} [comparator] The comparator invoked per element.
         * @returns {Array} Returns the new array of filtered values.
         * @example
         *
         * var objects = [{ 'x': 1, 'y': 2 }, { 'x': 2, 'y': 1 }];
         *
         * _.differenceWith(objects, [{ 'x': 1, 'y': 2 }], _.isEqual);
         * // => [{ 'x': 2, 'y': 1 }]
         */
        var differenceWith = baseRest(function(array, values) {
          var comparator = last(values);
          if (isArrayLikeObject(comparator)) {
            comparator = undefined$1;
          }
          return isArrayLikeObject(array)
            ? baseDifference(array, baseFlatten(values, 1, isArrayLikeObject, true), undefined$1, comparator)
            : [];
        });

        /**
         * Creates a slice of `array` with `n` elements dropped from the beginning.
         *
         * @static
         * @memberOf _
         * @since 0.5.0
         * @category Array
         * @param {Array} array The array to query.
         * @param {number} [n=1] The number of elements to drop.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {Array} Returns the slice of `array`.
         * @example
         *
         * _.drop([1, 2, 3]);
         * // => [2, 3]
         *
         * _.drop([1, 2, 3], 2);
         * // => [3]
         *
         * _.drop([1, 2, 3], 5);
         * // => []
         *
         * _.drop([1, 2, 3], 0);
         * // => [1, 2, 3]
         */
        function drop(array, n, guard) {
          var length = array == null ? 0 : array.length;
          if (!length) {
            return [];
          }
          n = (guard || n === undefined$1) ? 1 : toInteger(n);
          return baseSlice(array, n < 0 ? 0 : n, length);
        }

        /**
         * Creates a slice of `array` with `n` elements dropped from the end.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Array
         * @param {Array} array The array to query.
         * @param {number} [n=1] The number of elements to drop.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {Array} Returns the slice of `array`.
         * @example
         *
         * _.dropRight([1, 2, 3]);
         * // => [1, 2]
         *
         * _.dropRight([1, 2, 3], 2);
         * // => [1]
         *
         * _.dropRight([1, 2, 3], 5);
         * // => []
         *
         * _.dropRight([1, 2, 3], 0);
         * // => [1, 2, 3]
         */
        function dropRight(array, n, guard) {
          var length = array == null ? 0 : array.length;
          if (!length) {
            return [];
          }
          n = (guard || n === undefined$1) ? 1 : toInteger(n);
          n = length - n;
          return baseSlice(array, 0, n < 0 ? 0 : n);
        }

        /**
         * Creates a slice of `array` excluding elements dropped from the end.
         * Elements are dropped until `predicate` returns falsey. The predicate is
         * invoked with three arguments: (value, index, array).
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Array
         * @param {Array} array The array to query.
         * @param {Function} [predicate=_.identity] The function invoked per iteration.
         * @returns {Array} Returns the slice of `array`.
         * @example
         *
         * var users = [
         *   { 'user': 'barney',  'active': true },
         *   { 'user': 'fred',    'active': false },
         *   { 'user': 'pebbles', 'active': false }
         * ];
         *
         * _.dropRightWhile(users, function(o) { return !o.active; });
         * // => objects for ['barney']
         *
         * // The `_.matches` iteratee shorthand.
         * _.dropRightWhile(users, { 'user': 'pebbles', 'active': false });
         * // => objects for ['barney', 'fred']
         *
         * // The `_.matchesProperty` iteratee shorthand.
         * _.dropRightWhile(users, ['active', false]);
         * // => objects for ['barney']
         *
         * // The `_.property` iteratee shorthand.
         * _.dropRightWhile(users, 'active');
         * // => objects for ['barney', 'fred', 'pebbles']
         */
        function dropRightWhile(array, predicate) {
          return (array && array.length)
            ? baseWhile(array, getIteratee(predicate, 3), true, true)
            : [];
        }

        /**
         * Creates a slice of `array` excluding elements dropped from the beginning.
         * Elements are dropped until `predicate` returns falsey. The predicate is
         * invoked with three arguments: (value, index, array).
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Array
         * @param {Array} array The array to query.
         * @param {Function} [predicate=_.identity] The function invoked per iteration.
         * @returns {Array} Returns the slice of `array`.
         * @example
         *
         * var users = [
         *   { 'user': 'barney',  'active': false },
         *   { 'user': 'fred',    'active': false },
         *   { 'user': 'pebbles', 'active': true }
         * ];
         *
         * _.dropWhile(users, function(o) { return !o.active; });
         * // => objects for ['pebbles']
         *
         * // The `_.matches` iteratee shorthand.
         * _.dropWhile(users, { 'user': 'barney', 'active': false });
         * // => objects for ['fred', 'pebbles']
         *
         * // The `_.matchesProperty` iteratee shorthand.
         * _.dropWhile(users, ['active', false]);
         * // => objects for ['pebbles']
         *
         * // The `_.property` iteratee shorthand.
         * _.dropWhile(users, 'active');
         * // => objects for ['barney', 'fred', 'pebbles']
         */
        function dropWhile(array, predicate) {
          return (array && array.length)
            ? baseWhile(array, getIteratee(predicate, 3), true)
            : [];
        }

        /**
         * Fills elements of `array` with `value` from `start` up to, but not
         * including, `end`.
         *
         * **Note:** This method mutates `array`.
         *
         * @static
         * @memberOf _
         * @since 3.2.0
         * @category Array
         * @param {Array} array The array to fill.
         * @param {*} value The value to fill `array` with.
         * @param {number} [start=0] The start position.
         * @param {number} [end=array.length] The end position.
         * @returns {Array} Returns `array`.
         * @example
         *
         * var array = [1, 2, 3];
         *
         * _.fill(array, 'a');
         * console.log(array);
         * // => ['a', 'a', 'a']
         *
         * _.fill(Array(3), 2);
         * // => [2, 2, 2]
         *
         * _.fill([4, 6, 8, 10], '*', 1, 3);
         * // => [4, '*', '*', 10]
         */
        function fill(array, value, start, end) {
          var length = array == null ? 0 : array.length;
          if (!length) {
            return [];
          }
          if (start && typeof start != 'number' && isIterateeCall(array, value, start)) {
            start = 0;
            end = length;
          }
          return baseFill(array, value, start, end);
        }

        /**
         * This method is like `_.find` except that it returns the index of the first
         * element `predicate` returns truthy for instead of the element itself.
         *
         * @static
         * @memberOf _
         * @since 1.1.0
         * @category Array
         * @param {Array} array The array to inspect.
         * @param {Function} [predicate=_.identity] The function invoked per iteration.
         * @param {number} [fromIndex=0] The index to search from.
         * @returns {number} Returns the index of the found element, else `-1`.
         * @example
         *
         * var users = [
         *   { 'user': 'barney',  'active': false },
         *   { 'user': 'fred',    'active': false },
         *   { 'user': 'pebbles', 'active': true }
         * ];
         *
         * _.findIndex(users, function(o) { return o.user == 'barney'; });
         * // => 0
         *
         * // The `_.matches` iteratee shorthand.
         * _.findIndex(users, { 'user': 'fred', 'active': false });
         * // => 1
         *
         * // The `_.matchesProperty` iteratee shorthand.
         * _.findIndex(users, ['active', false]);
         * // => 0
         *
         * // The `_.property` iteratee shorthand.
         * _.findIndex(users, 'active');
         * // => 2
         */
        function findIndex(array, predicate, fromIndex) {
          var length = array == null ? 0 : array.length;
          if (!length) {
            return -1;
          }
          var index = fromIndex == null ? 0 : toInteger(fromIndex);
          if (index < 0) {
            index = nativeMax(length + index, 0);
          }
          return baseFindIndex(array, getIteratee(predicate, 3), index);
        }

        /**
         * This method is like `_.findIndex` except that it iterates over elements
         * of `collection` from right to left.
         *
         * @static
         * @memberOf _
         * @since 2.0.0
         * @category Array
         * @param {Array} array The array to inspect.
         * @param {Function} [predicate=_.identity] The function invoked per iteration.
         * @param {number} [fromIndex=array.length-1] The index to search from.
         * @returns {number} Returns the index of the found element, else `-1`.
         * @example
         *
         * var users = [
         *   { 'user': 'barney',  'active': true },
         *   { 'user': 'fred',    'active': false },
         *   { 'user': 'pebbles', 'active': false }
         * ];
         *
         * _.findLastIndex(users, function(o) { return o.user == 'pebbles'; });
         * // => 2
         *
         * // The `_.matches` iteratee shorthand.
         * _.findLastIndex(users, { 'user': 'barney', 'active': true });
         * // => 0
         *
         * // The `_.matchesProperty` iteratee shorthand.
         * _.findLastIndex(users, ['active', false]);
         * // => 2
         *
         * // The `_.property` iteratee shorthand.
         * _.findLastIndex(users, 'active');
         * // => 0
         */
        function findLastIndex(array, predicate, fromIndex) {
          var length = array == null ? 0 : array.length;
          if (!length) {
            return -1;
          }
          var index = length - 1;
          if (fromIndex !== undefined$1) {
            index = toInteger(fromIndex);
            index = fromIndex < 0
              ? nativeMax(length + index, 0)
              : nativeMin(index, length - 1);
          }
          return baseFindIndex(array, getIteratee(predicate, 3), index, true);
        }

        /**
         * Flattens `array` a single level deep.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Array
         * @param {Array} array The array to flatten.
         * @returns {Array} Returns the new flattened array.
         * @example
         *
         * _.flatten([1, [2, [3, [4]], 5]]);
         * // => [1, 2, [3, [4]], 5]
         */
        function flatten(array) {
          var length = array == null ? 0 : array.length;
          return length ? baseFlatten(array, 1) : [];
        }

        /**
         * Recursively flattens `array`.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Array
         * @param {Array} array The array to flatten.
         * @returns {Array} Returns the new flattened array.
         * @example
         *
         * _.flattenDeep([1, [2, [3, [4]], 5]]);
         * // => [1, 2, 3, 4, 5]
         */
        function flattenDeep(array) {
          var length = array == null ? 0 : array.length;
          return length ? baseFlatten(array, INFINITY) : [];
        }

        /**
         * Recursively flatten `array` up to `depth` times.
         *
         * @static
         * @memberOf _
         * @since 4.4.0
         * @category Array
         * @param {Array} array The array to flatten.
         * @param {number} [depth=1] The maximum recursion depth.
         * @returns {Array} Returns the new flattened array.
         * @example
         *
         * var array = [1, [2, [3, [4]], 5]];
         *
         * _.flattenDepth(array, 1);
         * // => [1, 2, [3, [4]], 5]
         *
         * _.flattenDepth(array, 2);
         * // => [1, 2, 3, [4], 5]
         */
        function flattenDepth(array, depth) {
          var length = array == null ? 0 : array.length;
          if (!length) {
            return [];
          }
          depth = depth === undefined$1 ? 1 : toInteger(depth);
          return baseFlatten(array, depth);
        }

        /**
         * The inverse of `_.toPairs`; this method returns an object composed
         * from key-value `pairs`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} pairs The key-value pairs.
         * @returns {Object} Returns the new object.
         * @example
         *
         * _.fromPairs([['a', 1], ['b', 2]]);
         * // => { 'a': 1, 'b': 2 }
         */
        function fromPairs(pairs) {
          var index = -1,
              length = pairs == null ? 0 : pairs.length,
              result = {};

          while (++index < length) {
            var pair = pairs[index];
            result[pair[0]] = pair[1];
          }
          return result;
        }

        /**
         * Gets the first element of `array`.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @alias first
         * @category Array
         * @param {Array} array The array to query.
         * @returns {*} Returns the first element of `array`.
         * @example
         *
         * _.head([1, 2, 3]);
         * // => 1
         *
         * _.head([]);
         * // => undefined
         */
        function head(array) {
          return (array && array.length) ? array[0] : undefined$1;
        }

        /**
         * Gets the index at which the first occurrence of `value` is found in `array`
         * using [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
         * for equality comparisons. If `fromIndex` is negative, it's used as the
         * offset from the end of `array`.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Array
         * @param {Array} array The array to inspect.
         * @param {*} value The value to search for.
         * @param {number} [fromIndex=0] The index to search from.
         * @returns {number} Returns the index of the matched value, else `-1`.
         * @example
         *
         * _.indexOf([1, 2, 1, 2], 2);
         * // => 1
         *
         * // Search from the `fromIndex`.
         * _.indexOf([1, 2, 1, 2], 2, 2);
         * // => 3
         */
        function indexOf(array, value, fromIndex) {
          var length = array == null ? 0 : array.length;
          if (!length) {
            return -1;
          }
          var index = fromIndex == null ? 0 : toInteger(fromIndex);
          if (index < 0) {
            index = nativeMax(length + index, 0);
          }
          return baseIndexOf(array, value, index);
        }

        /**
         * Gets all but the last element of `array`.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Array
         * @param {Array} array The array to query.
         * @returns {Array} Returns the slice of `array`.
         * @example
         *
         * _.initial([1, 2, 3]);
         * // => [1, 2]
         */
        function initial(array) {
          var length = array == null ? 0 : array.length;
          return length ? baseSlice(array, 0, -1) : [];
        }

        /**
         * Creates an array of unique values that are included in all given arrays
         * using [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
         * for equality comparisons. The order and references of result values are
         * determined by the first array.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Array
         * @param {...Array} [arrays] The arrays to inspect.
         * @returns {Array} Returns the new array of intersecting values.
         * @example
         *
         * _.intersection([2, 1], [2, 3]);
         * // => [2]
         */
        var intersection = baseRest(function(arrays) {
          var mapped = arrayMap(arrays, castArrayLikeObject);
          return (mapped.length && mapped[0] === arrays[0])
            ? baseIntersection(mapped)
            : [];
        });

        /**
         * This method is like `_.intersection` except that it accepts `iteratee`
         * which is invoked for each element of each `arrays` to generate the criterion
         * by which they're compared. The order and references of result values are
         * determined by the first array. The iteratee is invoked with one argument:
         * (value).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {...Array} [arrays] The arrays to inspect.
         * @param {Function} [iteratee=_.identity] The iteratee invoked per element.
         * @returns {Array} Returns the new array of intersecting values.
         * @example
         *
         * _.intersectionBy([2.1, 1.2], [2.3, 3.4], Math.floor);
         * // => [2.1]
         *
         * // The `_.property` iteratee shorthand.
         * _.intersectionBy([{ 'x': 1 }], [{ 'x': 2 }, { 'x': 1 }], 'x');
         * // => [{ 'x': 1 }]
         */
        var intersectionBy = baseRest(function(arrays) {
          var iteratee = last(arrays),
              mapped = arrayMap(arrays, castArrayLikeObject);

          if (iteratee === last(mapped)) {
            iteratee = undefined$1;
          } else {
            mapped.pop();
          }
          return (mapped.length && mapped[0] === arrays[0])
            ? baseIntersection(mapped, getIteratee(iteratee, 2))
            : [];
        });

        /**
         * This method is like `_.intersection` except that it accepts `comparator`
         * which is invoked to compare elements of `arrays`. The order and references
         * of result values are determined by the first array. The comparator is
         * invoked with two arguments: (arrVal, othVal).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {...Array} [arrays] The arrays to inspect.
         * @param {Function} [comparator] The comparator invoked per element.
         * @returns {Array} Returns the new array of intersecting values.
         * @example
         *
         * var objects = [{ 'x': 1, 'y': 2 }, { 'x': 2, 'y': 1 }];
         * var others = [{ 'x': 1, 'y': 1 }, { 'x': 1, 'y': 2 }];
         *
         * _.intersectionWith(objects, others, _.isEqual);
         * // => [{ 'x': 1, 'y': 2 }]
         */
        var intersectionWith = baseRest(function(arrays) {
          var comparator = last(arrays),
              mapped = arrayMap(arrays, castArrayLikeObject);

          comparator = typeof comparator == 'function' ? comparator : undefined$1;
          if (comparator) {
            mapped.pop();
          }
          return (mapped.length && mapped[0] === arrays[0])
            ? baseIntersection(mapped, undefined$1, comparator)
            : [];
        });

        /**
         * Converts all elements in `array` into a string separated by `separator`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} array The array to convert.
         * @param {string} [separator=','] The element separator.
         * @returns {string} Returns the joined string.
         * @example
         *
         * _.join(['a', 'b', 'c'], '~');
         * // => 'a~b~c'
         */
        function join(array, separator) {
          return array == null ? '' : nativeJoin.call(array, separator);
        }

        /**
         * Gets the last element of `array`.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Array
         * @param {Array} array The array to query.
         * @returns {*} Returns the last element of `array`.
         * @example
         *
         * _.last([1, 2, 3]);
         * // => 3
         */
        function last(array) {
          var length = array == null ? 0 : array.length;
          return length ? array[length - 1] : undefined$1;
        }

        /**
         * This method is like `_.indexOf` except that it iterates over elements of
         * `array` from right to left.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Array
         * @param {Array} array The array to inspect.
         * @param {*} value The value to search for.
         * @param {number} [fromIndex=array.length-1] The index to search from.
         * @returns {number} Returns the index of the matched value, else `-1`.
         * @example
         *
         * _.lastIndexOf([1, 2, 1, 2], 2);
         * // => 3
         *
         * // Search from the `fromIndex`.
         * _.lastIndexOf([1, 2, 1, 2], 2, 2);
         * // => 1
         */
        function lastIndexOf(array, value, fromIndex) {
          var length = array == null ? 0 : array.length;
          if (!length) {
            return -1;
          }
          var index = length;
          if (fromIndex !== undefined$1) {
            index = toInteger(fromIndex);
            index = index < 0 ? nativeMax(length + index, 0) : nativeMin(index, length - 1);
          }
          return value === value
            ? strictLastIndexOf(array, value, index)
            : baseFindIndex(array, baseIsNaN, index, true);
        }

        /**
         * Gets the element at index `n` of `array`. If `n` is negative, the nth
         * element from the end is returned.
         *
         * @static
         * @memberOf _
         * @since 4.11.0
         * @category Array
         * @param {Array} array The array to query.
         * @param {number} [n=0] The index of the element to return.
         * @returns {*} Returns the nth element of `array`.
         * @example
         *
         * var array = ['a', 'b', 'c', 'd'];
         *
         * _.nth(array, 1);
         * // => 'b'
         *
         * _.nth(array, -2);
         * // => 'c';
         */
        function nth(array, n) {
          return (array && array.length) ? baseNth(array, toInteger(n)) : undefined$1;
        }

        /**
         * Removes all given values from `array` using
         * [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
         * for equality comparisons.
         *
         * **Note:** Unlike `_.without`, this method mutates `array`. Use `_.remove`
         * to remove elements from an array by predicate.
         *
         * @static
         * @memberOf _
         * @since 2.0.0
         * @category Array
         * @param {Array} array The array to modify.
         * @param {...*} [values] The values to remove.
         * @returns {Array} Returns `array`.
         * @example
         *
         * var array = ['a', 'b', 'c', 'a', 'b', 'c'];
         *
         * _.pull(array, 'a', 'c');
         * console.log(array);
         * // => ['b', 'b']
         */
        var pull = baseRest(pullAll);

        /**
         * This method is like `_.pull` except that it accepts an array of values to remove.
         *
         * **Note:** Unlike `_.difference`, this method mutates `array`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} array The array to modify.
         * @param {Array} values The values to remove.
         * @returns {Array} Returns `array`.
         * @example
         *
         * var array = ['a', 'b', 'c', 'a', 'b', 'c'];
         *
         * _.pullAll(array, ['a', 'c']);
         * console.log(array);
         * // => ['b', 'b']
         */
        function pullAll(array, values) {
          return (array && array.length && values && values.length)
            ? basePullAll(array, values)
            : array;
        }

        /**
         * This method is like `_.pullAll` except that it accepts `iteratee` which is
         * invoked for each element of `array` and `values` to generate the criterion
         * by which they're compared. The iteratee is invoked with one argument: (value).
         *
         * **Note:** Unlike `_.differenceBy`, this method mutates `array`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} array The array to modify.
         * @param {Array} values The values to remove.
         * @param {Function} [iteratee=_.identity] The iteratee invoked per element.
         * @returns {Array} Returns `array`.
         * @example
         *
         * var array = [{ 'x': 1 }, { 'x': 2 }, { 'x': 3 }, { 'x': 1 }];
         *
         * _.pullAllBy(array, [{ 'x': 1 }, { 'x': 3 }], 'x');
         * console.log(array);
         * // => [{ 'x': 2 }]
         */
        function pullAllBy(array, values, iteratee) {
          return (array && array.length && values && values.length)
            ? basePullAll(array, values, getIteratee(iteratee, 2))
            : array;
        }

        /**
         * This method is like `_.pullAll` except that it accepts `comparator` which
         * is invoked to compare elements of `array` to `values`. The comparator is
         * invoked with two arguments: (arrVal, othVal).
         *
         * **Note:** Unlike `_.differenceWith`, this method mutates `array`.
         *
         * @static
         * @memberOf _
         * @since 4.6.0
         * @category Array
         * @param {Array} array The array to modify.
         * @param {Array} values The values to remove.
         * @param {Function} [comparator] The comparator invoked per element.
         * @returns {Array} Returns `array`.
         * @example
         *
         * var array = [{ 'x': 1, 'y': 2 }, { 'x': 3, 'y': 4 }, { 'x': 5, 'y': 6 }];
         *
         * _.pullAllWith(array, [{ 'x': 3, 'y': 4 }], _.isEqual);
         * console.log(array);
         * // => [{ 'x': 1, 'y': 2 }, { 'x': 5, 'y': 6 }]
         */
        function pullAllWith(array, values, comparator) {
          return (array && array.length && values && values.length)
            ? basePullAll(array, values, undefined$1, comparator)
            : array;
        }

        /**
         * Removes elements from `array` corresponding to `indexes` and returns an
         * array of removed elements.
         *
         * **Note:** Unlike `_.at`, this method mutates `array`.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Array
         * @param {Array} array The array to modify.
         * @param {...(number|number[])} [indexes] The indexes of elements to remove.
         * @returns {Array} Returns the new array of removed elements.
         * @example
         *
         * var array = ['a', 'b', 'c', 'd'];
         * var pulled = _.pullAt(array, [1, 3]);
         *
         * console.log(array);
         * // => ['a', 'c']
         *
         * console.log(pulled);
         * // => ['b', 'd']
         */
        var pullAt = flatRest(function(array, indexes) {
          var length = array == null ? 0 : array.length,
              result = baseAt(array, indexes);

          basePullAt(array, arrayMap(indexes, function(index) {
            return isIndex(index, length) ? +index : index;
          }).sort(compareAscending));

          return result;
        });

        /**
         * Removes all elements from `array` that `predicate` returns truthy for
         * and returns an array of the removed elements. The predicate is invoked
         * with three arguments: (value, index, array).
         *
         * **Note:** Unlike `_.filter`, this method mutates `array`. Use `_.pull`
         * to pull elements from an array by value.
         *
         * @static
         * @memberOf _
         * @since 2.0.0
         * @category Array
         * @param {Array} array The array to modify.
         * @param {Function} [predicate=_.identity] The function invoked per iteration.
         * @returns {Array} Returns the new array of removed elements.
         * @example
         *
         * var array = [1, 2, 3, 4];
         * var evens = _.remove(array, function(n) {
         *   return n % 2 == 0;
         * });
         *
         * console.log(array);
         * // => [1, 3]
         *
         * console.log(evens);
         * // => [2, 4]
         */
        function remove(array, predicate) {
          var result = [];
          if (!(array && array.length)) {
            return result;
          }
          var index = -1,
              indexes = [],
              length = array.length;

          predicate = getIteratee(predicate, 3);
          while (++index < length) {
            var value = array[index];
            if (predicate(value, index, array)) {
              result.push(value);
              indexes.push(index);
            }
          }
          basePullAt(array, indexes);
          return result;
        }

        /**
         * Reverses `array` so that the first element becomes the last, the second
         * element becomes the second to last, and so on.
         *
         * **Note:** This method mutates `array` and is based on
         * [`Array#reverse`](https://mdn.io/Array/reverse).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} array The array to modify.
         * @returns {Array} Returns `array`.
         * @example
         *
         * var array = [1, 2, 3];
         *
         * _.reverse(array);
         * // => [3, 2, 1]
         *
         * console.log(array);
         * // => [3, 2, 1]
         */
        function reverse(array) {
          return array == null ? array : nativeReverse.call(array);
        }

        /**
         * Creates a slice of `array` from `start` up to, but not including, `end`.
         *
         * **Note:** This method is used instead of
         * [`Array#slice`](https://mdn.io/Array/slice) to ensure dense arrays are
         * returned.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Array
         * @param {Array} array The array to slice.
         * @param {number} [start=0] The start position.
         * @param {number} [end=array.length] The end position.
         * @returns {Array} Returns the slice of `array`.
         */
        function slice(array, start, end) {
          var length = array == null ? 0 : array.length;
          if (!length) {
            return [];
          }
          if (end && typeof end != 'number' && isIterateeCall(array, start, end)) {
            start = 0;
            end = length;
          }
          else {
            start = start == null ? 0 : toInteger(start);
            end = end === undefined$1 ? length : toInteger(end);
          }
          return baseSlice(array, start, end);
        }

        /**
         * Uses a binary search to determine the lowest index at which `value`
         * should be inserted into `array` in order to maintain its sort order.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Array
         * @param {Array} array The sorted array to inspect.
         * @param {*} value The value to evaluate.
         * @returns {number} Returns the index at which `value` should be inserted
         *  into `array`.
         * @example
         *
         * _.sortedIndex([30, 50], 40);
         * // => 1
         */
        function sortedIndex(array, value) {
          return baseSortedIndex(array, value);
        }

        /**
         * This method is like `_.sortedIndex` except that it accepts `iteratee`
         * which is invoked for `value` and each element of `array` to compute their
         * sort ranking. The iteratee is invoked with one argument: (value).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} array The sorted array to inspect.
         * @param {*} value The value to evaluate.
         * @param {Function} [iteratee=_.identity] The iteratee invoked per element.
         * @returns {number} Returns the index at which `value` should be inserted
         *  into `array`.
         * @example
         *
         * var objects = [{ 'x': 4 }, { 'x': 5 }];
         *
         * _.sortedIndexBy(objects, { 'x': 4 }, function(o) { return o.x; });
         * // => 0
         *
         * // The `_.property` iteratee shorthand.
         * _.sortedIndexBy(objects, { 'x': 4 }, 'x');
         * // => 0
         */
        function sortedIndexBy(array, value, iteratee) {
          return baseSortedIndexBy(array, value, getIteratee(iteratee, 2));
        }

        /**
         * This method is like `_.indexOf` except that it performs a binary
         * search on a sorted `array`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} array The array to inspect.
         * @param {*} value The value to search for.
         * @returns {number} Returns the index of the matched value, else `-1`.
         * @example
         *
         * _.sortedIndexOf([4, 5, 5, 5, 6], 5);
         * // => 1
         */
        function sortedIndexOf(array, value) {
          var length = array == null ? 0 : array.length;
          if (length) {
            var index = baseSortedIndex(array, value);
            if (index < length && eq(array[index], value)) {
              return index;
            }
          }
          return -1;
        }

        /**
         * This method is like `_.sortedIndex` except that it returns the highest
         * index at which `value` should be inserted into `array` in order to
         * maintain its sort order.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Array
         * @param {Array} array The sorted array to inspect.
         * @param {*} value The value to evaluate.
         * @returns {number} Returns the index at which `value` should be inserted
         *  into `array`.
         * @example
         *
         * _.sortedLastIndex([4, 5, 5, 5, 6], 5);
         * // => 4
         */
        function sortedLastIndex(array, value) {
          return baseSortedIndex(array, value, true);
        }

        /**
         * This method is like `_.sortedLastIndex` except that it accepts `iteratee`
         * which is invoked for `value` and each element of `array` to compute their
         * sort ranking. The iteratee is invoked with one argument: (value).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} array The sorted array to inspect.
         * @param {*} value The value to evaluate.
         * @param {Function} [iteratee=_.identity] The iteratee invoked per element.
         * @returns {number} Returns the index at which `value` should be inserted
         *  into `array`.
         * @example
         *
         * var objects = [{ 'x': 4 }, { 'x': 5 }];
         *
         * _.sortedLastIndexBy(objects, { 'x': 4 }, function(o) { return o.x; });
         * // => 1
         *
         * // The `_.property` iteratee shorthand.
         * _.sortedLastIndexBy(objects, { 'x': 4 }, 'x');
         * // => 1
         */
        function sortedLastIndexBy(array, value, iteratee) {
          return baseSortedIndexBy(array, value, getIteratee(iteratee, 2), true);
        }

        /**
         * This method is like `_.lastIndexOf` except that it performs a binary
         * search on a sorted `array`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} array The array to inspect.
         * @param {*} value The value to search for.
         * @returns {number} Returns the index of the matched value, else `-1`.
         * @example
         *
         * _.sortedLastIndexOf([4, 5, 5, 5, 6], 5);
         * // => 3
         */
        function sortedLastIndexOf(array, value) {
          var length = array == null ? 0 : array.length;
          if (length) {
            var index = baseSortedIndex(array, value, true) - 1;
            if (eq(array[index], value)) {
              return index;
            }
          }
          return -1;
        }

        /**
         * This method is like `_.uniq` except that it's designed and optimized
         * for sorted arrays.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} array The array to inspect.
         * @returns {Array} Returns the new duplicate free array.
         * @example
         *
         * _.sortedUniq([1, 1, 2]);
         * // => [1, 2]
         */
        function sortedUniq(array) {
          return (array && array.length)
            ? baseSortedUniq(array)
            : [];
        }

        /**
         * This method is like `_.uniqBy` except that it's designed and optimized
         * for sorted arrays.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} array The array to inspect.
         * @param {Function} [iteratee] The iteratee invoked per element.
         * @returns {Array} Returns the new duplicate free array.
         * @example
         *
         * _.sortedUniqBy([1.1, 1.2, 2.3, 2.4], Math.floor);
         * // => [1.1, 2.3]
         */
        function sortedUniqBy(array, iteratee) {
          return (array && array.length)
            ? baseSortedUniq(array, getIteratee(iteratee, 2))
            : [];
        }

        /**
         * Gets all but the first element of `array`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} array The array to query.
         * @returns {Array} Returns the slice of `array`.
         * @example
         *
         * _.tail([1, 2, 3]);
         * // => [2, 3]
         */
        function tail(array) {
          var length = array == null ? 0 : array.length;
          return length ? baseSlice(array, 1, length) : [];
        }

        /**
         * Creates a slice of `array` with `n` elements taken from the beginning.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Array
         * @param {Array} array The array to query.
         * @param {number} [n=1] The number of elements to take.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {Array} Returns the slice of `array`.
         * @example
         *
         * _.take([1, 2, 3]);
         * // => [1]
         *
         * _.take([1, 2, 3], 2);
         * // => [1, 2]
         *
         * _.take([1, 2, 3], 5);
         * // => [1, 2, 3]
         *
         * _.take([1, 2, 3], 0);
         * // => []
         */
        function take(array, n, guard) {
          if (!(array && array.length)) {
            return [];
          }
          n = (guard || n === undefined$1) ? 1 : toInteger(n);
          return baseSlice(array, 0, n < 0 ? 0 : n);
        }

        /**
         * Creates a slice of `array` with `n` elements taken from the end.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Array
         * @param {Array} array The array to query.
         * @param {number} [n=1] The number of elements to take.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {Array} Returns the slice of `array`.
         * @example
         *
         * _.takeRight([1, 2, 3]);
         * // => [3]
         *
         * _.takeRight([1, 2, 3], 2);
         * // => [2, 3]
         *
         * _.takeRight([1, 2, 3], 5);
         * // => [1, 2, 3]
         *
         * _.takeRight([1, 2, 3], 0);
         * // => []
         */
        function takeRight(array, n, guard) {
          var length = array == null ? 0 : array.length;
          if (!length) {
            return [];
          }
          n = (guard || n === undefined$1) ? 1 : toInteger(n);
          n = length - n;
          return baseSlice(array, n < 0 ? 0 : n, length);
        }

        /**
         * Creates a slice of `array` with elements taken from the end. Elements are
         * taken until `predicate` returns falsey. The predicate is invoked with
         * three arguments: (value, index, array).
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Array
         * @param {Array} array The array to query.
         * @param {Function} [predicate=_.identity] The function invoked per iteration.
         * @returns {Array} Returns the slice of `array`.
         * @example
         *
         * var users = [
         *   { 'user': 'barney',  'active': true },
         *   { 'user': 'fred',    'active': false },
         *   { 'user': 'pebbles', 'active': false }
         * ];
         *
         * _.takeRightWhile(users, function(o) { return !o.active; });
         * // => objects for ['fred', 'pebbles']
         *
         * // The `_.matches` iteratee shorthand.
         * _.takeRightWhile(users, { 'user': 'pebbles', 'active': false });
         * // => objects for ['pebbles']
         *
         * // The `_.matchesProperty` iteratee shorthand.
         * _.takeRightWhile(users, ['active', false]);
         * // => objects for ['fred', 'pebbles']
         *
         * // The `_.property` iteratee shorthand.
         * _.takeRightWhile(users, 'active');
         * // => []
         */
        function takeRightWhile(array, predicate) {
          return (array && array.length)
            ? baseWhile(array, getIteratee(predicate, 3), false, true)
            : [];
        }

        /**
         * Creates a slice of `array` with elements taken from the beginning. Elements
         * are taken until `predicate` returns falsey. The predicate is invoked with
         * three arguments: (value, index, array).
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Array
         * @param {Array} array The array to query.
         * @param {Function} [predicate=_.identity] The function invoked per iteration.
         * @returns {Array} Returns the slice of `array`.
         * @example
         *
         * var users = [
         *   { 'user': 'barney',  'active': false },
         *   { 'user': 'fred',    'active': false },
         *   { 'user': 'pebbles', 'active': true }
         * ];
         *
         * _.takeWhile(users, function(o) { return !o.active; });
         * // => objects for ['barney', 'fred']
         *
         * // The `_.matches` iteratee shorthand.
         * _.takeWhile(users, { 'user': 'barney', 'active': false });
         * // => objects for ['barney']
         *
         * // The `_.matchesProperty` iteratee shorthand.
         * _.takeWhile(users, ['active', false]);
         * // => objects for ['barney', 'fred']
         *
         * // The `_.property` iteratee shorthand.
         * _.takeWhile(users, 'active');
         * // => []
         */
        function takeWhile(array, predicate) {
          return (array && array.length)
            ? baseWhile(array, getIteratee(predicate, 3))
            : [];
        }

        /**
         * Creates an array of unique values, in order, from all given arrays using
         * [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
         * for equality comparisons.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Array
         * @param {...Array} [arrays] The arrays to inspect.
         * @returns {Array} Returns the new array of combined values.
         * @example
         *
         * _.union([2], [1, 2]);
         * // => [2, 1]
         */
        var union = baseRest(function(arrays) {
          return baseUniq(baseFlatten(arrays, 1, isArrayLikeObject, true));
        });

        /**
         * This method is like `_.union` except that it accepts `iteratee` which is
         * invoked for each element of each `arrays` to generate the criterion by
         * which uniqueness is computed. Result values are chosen from the first
         * array in which the value occurs. The iteratee is invoked with one argument:
         * (value).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {...Array} [arrays] The arrays to inspect.
         * @param {Function} [iteratee=_.identity] The iteratee invoked per element.
         * @returns {Array} Returns the new array of combined values.
         * @example
         *
         * _.unionBy([2.1], [1.2, 2.3], Math.floor);
         * // => [2.1, 1.2]
         *
         * // The `_.property` iteratee shorthand.
         * _.unionBy([{ 'x': 1 }], [{ 'x': 2 }, { 'x': 1 }], 'x');
         * // => [{ 'x': 1 }, { 'x': 2 }]
         */
        var unionBy = baseRest(function(arrays) {
          var iteratee = last(arrays);
          if (isArrayLikeObject(iteratee)) {
            iteratee = undefined$1;
          }
          return baseUniq(baseFlatten(arrays, 1, isArrayLikeObject, true), getIteratee(iteratee, 2));
        });

        /**
         * This method is like `_.union` except that it accepts `comparator` which
         * is invoked to compare elements of `arrays`. Result values are chosen from
         * the first array in which the value occurs. The comparator is invoked
         * with two arguments: (arrVal, othVal).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {...Array} [arrays] The arrays to inspect.
         * @param {Function} [comparator] The comparator invoked per element.
         * @returns {Array} Returns the new array of combined values.
         * @example
         *
         * var objects = [{ 'x': 1, 'y': 2 }, { 'x': 2, 'y': 1 }];
         * var others = [{ 'x': 1, 'y': 1 }, { 'x': 1, 'y': 2 }];
         *
         * _.unionWith(objects, others, _.isEqual);
         * // => [{ 'x': 1, 'y': 2 }, { 'x': 2, 'y': 1 }, { 'x': 1, 'y': 1 }]
         */
        var unionWith = baseRest(function(arrays) {
          var comparator = last(arrays);
          comparator = typeof comparator == 'function' ? comparator : undefined$1;
          return baseUniq(baseFlatten(arrays, 1, isArrayLikeObject, true), undefined$1, comparator);
        });

        /**
         * Creates a duplicate-free version of an array, using
         * [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
         * for equality comparisons, in which only the first occurrence of each element
         * is kept. The order of result values is determined by the order they occur
         * in the array.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Array
         * @param {Array} array The array to inspect.
         * @returns {Array} Returns the new duplicate free array.
         * @example
         *
         * _.uniq([2, 1, 2]);
         * // => [2, 1]
         */
        function uniq(array) {
          return (array && array.length) ? baseUniq(array) : [];
        }

        /**
         * This method is like `_.uniq` except that it accepts `iteratee` which is
         * invoked for each element in `array` to generate the criterion by which
         * uniqueness is computed. The order of result values is determined by the
         * order they occur in the array. The iteratee is invoked with one argument:
         * (value).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} array The array to inspect.
         * @param {Function} [iteratee=_.identity] The iteratee invoked per element.
         * @returns {Array} Returns the new duplicate free array.
         * @example
         *
         * _.uniqBy([2.1, 1.2, 2.3], Math.floor);
         * // => [2.1, 1.2]
         *
         * // The `_.property` iteratee shorthand.
         * _.uniqBy([{ 'x': 1 }, { 'x': 2 }, { 'x': 1 }], 'x');
         * // => [{ 'x': 1 }, { 'x': 2 }]
         */
        function uniqBy(array, iteratee) {
          return (array && array.length) ? baseUniq(array, getIteratee(iteratee, 2)) : [];
        }

        /**
         * This method is like `_.uniq` except that it accepts `comparator` which
         * is invoked to compare elements of `array`. The order of result values is
         * determined by the order they occur in the array.The comparator is invoked
         * with two arguments: (arrVal, othVal).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {Array} array The array to inspect.
         * @param {Function} [comparator] The comparator invoked per element.
         * @returns {Array} Returns the new duplicate free array.
         * @example
         *
         * var objects = [{ 'x': 1, 'y': 2 }, { 'x': 2, 'y': 1 }, { 'x': 1, 'y': 2 }];
         *
         * _.uniqWith(objects, _.isEqual);
         * // => [{ 'x': 1, 'y': 2 }, { 'x': 2, 'y': 1 }]
         */
        function uniqWith(array, comparator) {
          comparator = typeof comparator == 'function' ? comparator : undefined$1;
          return (array && array.length) ? baseUniq(array, undefined$1, comparator) : [];
        }

        /**
         * This method is like `_.zip` except that it accepts an array of grouped
         * elements and creates an array regrouping the elements to their pre-zip
         * configuration.
         *
         * @static
         * @memberOf _
         * @since 1.2.0
         * @category Array
         * @param {Array} array The array of grouped elements to process.
         * @returns {Array} Returns the new array of regrouped elements.
         * @example
         *
         * var zipped = _.zip(['a', 'b'], [1, 2], [true, false]);
         * // => [['a', 1, true], ['b', 2, false]]
         *
         * _.unzip(zipped);
         * // => [['a', 'b'], [1, 2], [true, false]]
         */
        function unzip(array) {
          if (!(array && array.length)) {
            return [];
          }
          var length = 0;
          array = arrayFilter(array, function(group) {
            if (isArrayLikeObject(group)) {
              length = nativeMax(group.length, length);
              return true;
            }
          });
          return baseTimes(length, function(index) {
            return arrayMap(array, baseProperty(index));
          });
        }

        /**
         * This method is like `_.unzip` except that it accepts `iteratee` to specify
         * how regrouped values should be combined. The iteratee is invoked with the
         * elements of each group: (...group).
         *
         * @static
         * @memberOf _
         * @since 3.8.0
         * @category Array
         * @param {Array} array The array of grouped elements to process.
         * @param {Function} [iteratee=_.identity] The function to combine
         *  regrouped values.
         * @returns {Array} Returns the new array of regrouped elements.
         * @example
         *
         * var zipped = _.zip([1, 2], [10, 20], [100, 200]);
         * // => [[1, 10, 100], [2, 20, 200]]
         *
         * _.unzipWith(zipped, _.add);
         * // => [3, 30, 300]
         */
        function unzipWith(array, iteratee) {
          if (!(array && array.length)) {
            return [];
          }
          var result = unzip(array);
          if (iteratee == null) {
            return result;
          }
          return arrayMap(result, function(group) {
            return apply(iteratee, undefined$1, group);
          });
        }

        /**
         * Creates an array excluding all given values using
         * [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
         * for equality comparisons.
         *
         * **Note:** Unlike `_.pull`, this method returns a new array.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Array
         * @param {Array} array The array to inspect.
         * @param {...*} [values] The values to exclude.
         * @returns {Array} Returns the new array of filtered values.
         * @see _.difference, _.xor
         * @example
         *
         * _.without([2, 1, 2, 3], 1, 2);
         * // => [3]
         */
        var without = baseRest(function(array, values) {
          return isArrayLikeObject(array)
            ? baseDifference(array, values)
            : [];
        });

        /**
         * Creates an array of unique values that is the
         * [symmetric difference](https://en.wikipedia.org/wiki/Symmetric_difference)
         * of the given arrays. The order of result values is determined by the order
         * they occur in the arrays.
         *
         * @static
         * @memberOf _
         * @since 2.4.0
         * @category Array
         * @param {...Array} [arrays] The arrays to inspect.
         * @returns {Array} Returns the new array of filtered values.
         * @see _.difference, _.without
         * @example
         *
         * _.xor([2, 1], [2, 3]);
         * // => [1, 3]
         */
        var xor = baseRest(function(arrays) {
          return baseXor(arrayFilter(arrays, isArrayLikeObject));
        });

        /**
         * This method is like `_.xor` except that it accepts `iteratee` which is
         * invoked for each element of each `arrays` to generate the criterion by
         * which by which they're compared. The order of result values is determined
         * by the order they occur in the arrays. The iteratee is invoked with one
         * argument: (value).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {...Array} [arrays] The arrays to inspect.
         * @param {Function} [iteratee=_.identity] The iteratee invoked per element.
         * @returns {Array} Returns the new array of filtered values.
         * @example
         *
         * _.xorBy([2.1, 1.2], [2.3, 3.4], Math.floor);
         * // => [1.2, 3.4]
         *
         * // The `_.property` iteratee shorthand.
         * _.xorBy([{ 'x': 1 }], [{ 'x': 2 }, { 'x': 1 }], 'x');
         * // => [{ 'x': 2 }]
         */
        var xorBy = baseRest(function(arrays) {
          var iteratee = last(arrays);
          if (isArrayLikeObject(iteratee)) {
            iteratee = undefined$1;
          }
          return baseXor(arrayFilter(arrays, isArrayLikeObject), getIteratee(iteratee, 2));
        });

        /**
         * This method is like `_.xor` except that it accepts `comparator` which is
         * invoked to compare elements of `arrays`. The order of result values is
         * determined by the order they occur in the arrays. The comparator is invoked
         * with two arguments: (arrVal, othVal).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Array
         * @param {...Array} [arrays] The arrays to inspect.
         * @param {Function} [comparator] The comparator invoked per element.
         * @returns {Array} Returns the new array of filtered values.
         * @example
         *
         * var objects = [{ 'x': 1, 'y': 2 }, { 'x': 2, 'y': 1 }];
         * var others = [{ 'x': 1, 'y': 1 }, { 'x': 1, 'y': 2 }];
         *
         * _.xorWith(objects, others, _.isEqual);
         * // => [{ 'x': 2, 'y': 1 }, { 'x': 1, 'y': 1 }]
         */
        var xorWith = baseRest(function(arrays) {
          var comparator = last(arrays);
          comparator = typeof comparator == 'function' ? comparator : undefined$1;
          return baseXor(arrayFilter(arrays, isArrayLikeObject), undefined$1, comparator);
        });

        /**
         * Creates an array of grouped elements, the first of which contains the
         * first elements of the given arrays, the second of which contains the
         * second elements of the given arrays, and so on.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Array
         * @param {...Array} [arrays] The arrays to process.
         * @returns {Array} Returns the new array of grouped elements.
         * @example
         *
         * _.zip(['a', 'b'], [1, 2], [true, false]);
         * // => [['a', 1, true], ['b', 2, false]]
         */
        var zip = baseRest(unzip);

        /**
         * This method is like `_.fromPairs` except that it accepts two arrays,
         * one of property identifiers and one of corresponding values.
         *
         * @static
         * @memberOf _
         * @since 0.4.0
         * @category Array
         * @param {Array} [props=[]] The property identifiers.
         * @param {Array} [values=[]] The property values.
         * @returns {Object} Returns the new object.
         * @example
         *
         * _.zipObject(['a', 'b'], [1, 2]);
         * // => { 'a': 1, 'b': 2 }
         */
        function zipObject(props, values) {
          return baseZipObject(props || [], values || [], assignValue);
        }

        /**
         * This method is like `_.zipObject` except that it supports property paths.
         *
         * @static
         * @memberOf _
         * @since 4.1.0
         * @category Array
         * @param {Array} [props=[]] The property identifiers.
         * @param {Array} [values=[]] The property values.
         * @returns {Object} Returns the new object.
         * @example
         *
         * _.zipObjectDeep(['a.b[0].c', 'a.b[1].d'], [1, 2]);
         * // => { 'a': { 'b': [{ 'c': 1 }, { 'd': 2 }] } }
         */
        function zipObjectDeep(props, values) {
          return baseZipObject(props || [], values || [], baseSet);
        }

        /**
         * This method is like `_.zip` except that it accepts `iteratee` to specify
         * how grouped values should be combined. The iteratee is invoked with the
         * elements of each group: (...group).
         *
         * @static
         * @memberOf _
         * @since 3.8.0
         * @category Array
         * @param {...Array} [arrays] The arrays to process.
         * @param {Function} [iteratee=_.identity] The function to combine
         *  grouped values.
         * @returns {Array} Returns the new array of grouped elements.
         * @example
         *
         * _.zipWith([1, 2], [10, 20], [100, 200], function(a, b, c) {
         *   return a + b + c;
         * });
         * // => [111, 222]
         */
        var zipWith = baseRest(function(arrays) {
          var length = arrays.length,
              iteratee = length > 1 ? arrays[length - 1] : undefined$1;

          iteratee = typeof iteratee == 'function' ? (arrays.pop(), iteratee) : undefined$1;
          return unzipWith(arrays, iteratee);
        });

        /*------------------------------------------------------------------------*/

        /**
         * Creates a `lodash` wrapper instance that wraps `value` with explicit method
         * chain sequences enabled. The result of such sequences must be unwrapped
         * with `_#value`.
         *
         * @static
         * @memberOf _
         * @since 1.3.0
         * @category Seq
         * @param {*} value The value to wrap.
         * @returns {Object} Returns the new `lodash` wrapper instance.
         * @example
         *
         * var users = [
         *   { 'user': 'barney',  'age': 36 },
         *   { 'user': 'fred',    'age': 40 },
         *   { 'user': 'pebbles', 'age': 1 }
         * ];
         *
         * var youngest = _
         *   .chain(users)
         *   .sortBy('age')
         *   .map(function(o) {
         *     return o.user + ' is ' + o.age;
         *   })
         *   .head()
         *   .value();
         * // => 'pebbles is 1'
         */
        function chain(value) {
          var result = lodash(value);
          result.__chain__ = true;
          return result;
        }

        /**
         * This method invokes `interceptor` and returns `value`. The interceptor
         * is invoked with one argument; (value). The purpose of this method is to
         * "tap into" a method chain sequence in order to modify intermediate results.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Seq
         * @param {*} value The value to provide to `interceptor`.
         * @param {Function} interceptor The function to invoke.
         * @returns {*} Returns `value`.
         * @example
         *
         * _([1, 2, 3])
         *  .tap(function(array) {
         *    // Mutate input array.
         *    array.pop();
         *  })
         *  .reverse()
         *  .value();
         * // => [2, 1]
         */
        function tap(value, interceptor) {
          interceptor(value);
          return value;
        }

        /**
         * This method is like `_.tap` except that it returns the result of `interceptor`.
         * The purpose of this method is to "pass thru" values replacing intermediate
         * results in a method chain sequence.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Seq
         * @param {*} value The value to provide to `interceptor`.
         * @param {Function} interceptor The function to invoke.
         * @returns {*} Returns the result of `interceptor`.
         * @example
         *
         * _('  abc  ')
         *  .chain()
         *  .trim()
         *  .thru(function(value) {
         *    return [value];
         *  })
         *  .value();
         * // => ['abc']
         */
        function thru(value, interceptor) {
          return interceptor(value);
        }

        /**
         * This method is the wrapper version of `_.at`.
         *
         * @name at
         * @memberOf _
         * @since 1.0.0
         * @category Seq
         * @param {...(string|string[])} [paths] The property paths to pick.
         * @returns {Object} Returns the new `lodash` wrapper instance.
         * @example
         *
         * var object = { 'a': [{ 'b': { 'c': 3 } }, 4] };
         *
         * _(object).at(['a[0].b.c', 'a[1]']).value();
         * // => [3, 4]
         */
        var wrapperAt = flatRest(function(paths) {
          var length = paths.length,
              start = length ? paths[0] : 0,
              value = this.__wrapped__,
              interceptor = function(object) { return baseAt(object, paths); };

          if (length > 1 || this.__actions__.length ||
              !(value instanceof LazyWrapper) || !isIndex(start)) {
            return this.thru(interceptor);
          }
          value = value.slice(start, +start + (length ? 1 : 0));
          value.__actions__.push({
            'func': thru,
            'args': [interceptor],
            'thisArg': undefined$1
          });
          return new LodashWrapper(value, this.__chain__).thru(function(array) {
            if (length && !array.length) {
              array.push(undefined$1);
            }
            return array;
          });
        });

        /**
         * Creates a `lodash` wrapper instance with explicit method chain sequences enabled.
         *
         * @name chain
         * @memberOf _
         * @since 0.1.0
         * @category Seq
         * @returns {Object} Returns the new `lodash` wrapper instance.
         * @example
         *
         * var users = [
         *   { 'user': 'barney', 'age': 36 },
         *   { 'user': 'fred',   'age': 40 }
         * ];
         *
         * // A sequence without explicit chaining.
         * _(users).head();
         * // => { 'user': 'barney', 'age': 36 }
         *
         * // A sequence with explicit chaining.
         * _(users)
         *   .chain()
         *   .head()
         *   .pick('user')
         *   .value();
         * // => { 'user': 'barney' }
         */
        function wrapperChain() {
          return chain(this);
        }

        /**
         * Executes the chain sequence and returns the wrapped result.
         *
         * @name commit
         * @memberOf _
         * @since 3.2.0
         * @category Seq
         * @returns {Object} Returns the new `lodash` wrapper instance.
         * @example
         *
         * var array = [1, 2];
         * var wrapped = _(array).push(3);
         *
         * console.log(array);
         * // => [1, 2]
         *
         * wrapped = wrapped.commit();
         * console.log(array);
         * // => [1, 2, 3]
         *
         * wrapped.last();
         * // => 3
         *
         * console.log(array);
         * // => [1, 2, 3]
         */
        function wrapperCommit() {
          return new LodashWrapper(this.value(), this.__chain__);
        }

        /**
         * Gets the next value on a wrapped object following the
         * [iterator protocol](https://mdn.io/iteration_protocols#iterator).
         *
         * @name next
         * @memberOf _
         * @since 4.0.0
         * @category Seq
         * @returns {Object} Returns the next iterator value.
         * @example
         *
         * var wrapped = _([1, 2]);
         *
         * wrapped.next();
         * // => { 'done': false, 'value': 1 }
         *
         * wrapped.next();
         * // => { 'done': false, 'value': 2 }
         *
         * wrapped.next();
         * // => { 'done': true, 'value': undefined }
         */
        function wrapperNext() {
          if (this.__values__ === undefined$1) {
            this.__values__ = toArray(this.value());
          }
          var done = this.__index__ >= this.__values__.length,
              value = done ? undefined$1 : this.__values__[this.__index__++];

          return { 'done': done, 'value': value };
        }

        /**
         * Enables the wrapper to be iterable.
         *
         * @name Symbol.iterator
         * @memberOf _
         * @since 4.0.0
         * @category Seq
         * @returns {Object} Returns the wrapper object.
         * @example
         *
         * var wrapped = _([1, 2]);
         *
         * wrapped[Symbol.iterator]() === wrapped;
         * // => true
         *
         * Array.from(wrapped);
         * // => [1, 2]
         */
        function wrapperToIterator() {
          return this;
        }

        /**
         * Creates a clone of the chain sequence planting `value` as the wrapped value.
         *
         * @name plant
         * @memberOf _
         * @since 3.2.0
         * @category Seq
         * @param {*} value The value to plant.
         * @returns {Object} Returns the new `lodash` wrapper instance.
         * @example
         *
         * function square(n) {
         *   return n * n;
         * }
         *
         * var wrapped = _([1, 2]).map(square);
         * var other = wrapped.plant([3, 4]);
         *
         * other.value();
         * // => [9, 16]
         *
         * wrapped.value();
         * // => [1, 4]
         */
        function wrapperPlant(value) {
          var result,
              parent = this;

          while (parent instanceof baseLodash) {
            var clone = wrapperClone(parent);
            clone.__index__ = 0;
            clone.__values__ = undefined$1;
            if (result) {
              previous.__wrapped__ = clone;
            } else {
              result = clone;
            }
            var previous = clone;
            parent = parent.__wrapped__;
          }
          previous.__wrapped__ = value;
          return result;
        }

        /**
         * This method is the wrapper version of `_.reverse`.
         *
         * **Note:** This method mutates the wrapped array.
         *
         * @name reverse
         * @memberOf _
         * @since 0.1.0
         * @category Seq
         * @returns {Object} Returns the new `lodash` wrapper instance.
         * @example
         *
         * var array = [1, 2, 3];
         *
         * _(array).reverse().value()
         * // => [3, 2, 1]
         *
         * console.log(array);
         * // => [3, 2, 1]
         */
        function wrapperReverse() {
          var value = this.__wrapped__;
          if (value instanceof LazyWrapper) {
            var wrapped = value;
            if (this.__actions__.length) {
              wrapped = new LazyWrapper(this);
            }
            wrapped = wrapped.reverse();
            wrapped.__actions__.push({
              'func': thru,
              'args': [reverse],
              'thisArg': undefined$1
            });
            return new LodashWrapper(wrapped, this.__chain__);
          }
          return this.thru(reverse);
        }

        /**
         * Executes the chain sequence to resolve the unwrapped value.
         *
         * @name value
         * @memberOf _
         * @since 0.1.0
         * @alias toJSON, valueOf
         * @category Seq
         * @returns {*} Returns the resolved unwrapped value.
         * @example
         *
         * _([1, 2, 3]).value();
         * // => [1, 2, 3]
         */
        function wrapperValue() {
          return baseWrapperValue(this.__wrapped__, this.__actions__);
        }

        /*------------------------------------------------------------------------*/

        /**
         * Creates an object composed of keys generated from the results of running
         * each element of `collection` thru `iteratee`. The corresponding value of
         * each key is the number of times the key was returned by `iteratee`. The
         * iteratee is invoked with one argument: (value).
         *
         * @static
         * @memberOf _
         * @since 0.5.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} [iteratee=_.identity] The iteratee to transform keys.
         * @returns {Object} Returns the composed aggregate object.
         * @example
         *
         * _.countBy([6.1, 4.2, 6.3], Math.floor);
         * // => { '4': 1, '6': 2 }
         *
         * // The `_.property` iteratee shorthand.
         * _.countBy(['one', 'two', 'three'], 'length');
         * // => { '3': 2, '5': 1 }
         */
        var countBy = createAggregator(function(result, value, key) {
          if (hasOwnProperty.call(result, key)) {
            ++result[key];
          } else {
            baseAssignValue(result, key, 1);
          }
        });

        /**
         * Checks if `predicate` returns truthy for **all** elements of `collection`.
         * Iteration is stopped once `predicate` returns falsey. The predicate is
         * invoked with three arguments: (value, index|key, collection).
         *
         * **Note:** This method returns `true` for
         * [empty collections](https://en.wikipedia.org/wiki/Empty_set) because
         * [everything is true](https://en.wikipedia.org/wiki/Vacuous_truth) of
         * elements of empty collections.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} [predicate=_.identity] The function invoked per iteration.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {boolean} Returns `true` if all elements pass the predicate check,
         *  else `false`.
         * @example
         *
         * _.every([true, 1, null, 'yes'], Boolean);
         * // => false
         *
         * var users = [
         *   { 'user': 'barney', 'age': 36, 'active': false },
         *   { 'user': 'fred',   'age': 40, 'active': false }
         * ];
         *
         * // The `_.matches` iteratee shorthand.
         * _.every(users, { 'user': 'barney', 'active': false });
         * // => false
         *
         * // The `_.matchesProperty` iteratee shorthand.
         * _.every(users, ['active', false]);
         * // => true
         *
         * // The `_.property` iteratee shorthand.
         * _.every(users, 'active');
         * // => false
         */
        function every(collection, predicate, guard) {
          var func = isArray(collection) ? arrayEvery : baseEvery;
          if (guard && isIterateeCall(collection, predicate, guard)) {
            predicate = undefined$1;
          }
          return func(collection, getIteratee(predicate, 3));
        }

        /**
         * Iterates over elements of `collection`, returning an array of all elements
         * `predicate` returns truthy for. The predicate is invoked with three
         * arguments: (value, index|key, collection).
         *
         * **Note:** Unlike `_.remove`, this method returns a new array.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} [predicate=_.identity] The function invoked per iteration.
         * @returns {Array} Returns the new filtered array.
         * @see _.reject
         * @example
         *
         * var users = [
         *   { 'user': 'barney', 'age': 36, 'active': true },
         *   { 'user': 'fred',   'age': 40, 'active': false }
         * ];
         *
         * _.filter(users, function(o) { return !o.active; });
         * // => objects for ['fred']
         *
         * // The `_.matches` iteratee shorthand.
         * _.filter(users, { 'age': 36, 'active': true });
         * // => objects for ['barney']
         *
         * // The `_.matchesProperty` iteratee shorthand.
         * _.filter(users, ['active', false]);
         * // => objects for ['fred']
         *
         * // The `_.property` iteratee shorthand.
         * _.filter(users, 'active');
         * // => objects for ['barney']
         *
         * // Combining several predicates using `_.overEvery` or `_.overSome`.
         * _.filter(users, _.overSome([{ 'age': 36 }, ['age', 40]]));
         * // => objects for ['fred', 'barney']
         */
        function filter(collection, predicate) {
          var func = isArray(collection) ? arrayFilter : baseFilter;
          return func(collection, getIteratee(predicate, 3));
        }

        /**
         * Iterates over elements of `collection`, returning the first element
         * `predicate` returns truthy for. The predicate is invoked with three
         * arguments: (value, index|key, collection).
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Collection
         * @param {Array|Object} collection The collection to inspect.
         * @param {Function} [predicate=_.identity] The function invoked per iteration.
         * @param {number} [fromIndex=0] The index to search from.
         * @returns {*} Returns the matched element, else `undefined`.
         * @example
         *
         * var users = [
         *   { 'user': 'barney',  'age': 36, 'active': true },
         *   { 'user': 'fred',    'age': 40, 'active': false },
         *   { 'user': 'pebbles', 'age': 1,  'active': true }
         * ];
         *
         * _.find(users, function(o) { return o.age < 40; });
         * // => object for 'barney'
         *
         * // The `_.matches` iteratee shorthand.
         * _.find(users, { 'age': 1, 'active': true });
         * // => object for 'pebbles'
         *
         * // The `_.matchesProperty` iteratee shorthand.
         * _.find(users, ['active', false]);
         * // => object for 'fred'
         *
         * // The `_.property` iteratee shorthand.
         * _.find(users, 'active');
         * // => object for 'barney'
         */
        var find = createFind(findIndex);

        /**
         * This method is like `_.find` except that it iterates over elements of
         * `collection` from right to left.
         *
         * @static
         * @memberOf _
         * @since 2.0.0
         * @category Collection
         * @param {Array|Object} collection The collection to inspect.
         * @param {Function} [predicate=_.identity] The function invoked per iteration.
         * @param {number} [fromIndex=collection.length-1] The index to search from.
         * @returns {*} Returns the matched element, else `undefined`.
         * @example
         *
         * _.findLast([1, 2, 3, 4], function(n) {
         *   return n % 2 == 1;
         * });
         * // => 3
         */
        var findLast = createFind(findLastIndex);

        /**
         * Creates a flattened array of values by running each element in `collection`
         * thru `iteratee` and flattening the mapped results. The iteratee is invoked
         * with three arguments: (value, index|key, collection).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} [iteratee=_.identity] The function invoked per iteration.
         * @returns {Array} Returns the new flattened array.
         * @example
         *
         * function duplicate(n) {
         *   return [n, n];
         * }
         *
         * _.flatMap([1, 2], duplicate);
         * // => [1, 1, 2, 2]
         */
        function flatMap(collection, iteratee) {
          return baseFlatten(map(collection, iteratee), 1);
        }

        /**
         * This method is like `_.flatMap` except that it recursively flattens the
         * mapped results.
         *
         * @static
         * @memberOf _
         * @since 4.7.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} [iteratee=_.identity] The function invoked per iteration.
         * @returns {Array} Returns the new flattened array.
         * @example
         *
         * function duplicate(n) {
         *   return [[[n, n]]];
         * }
         *
         * _.flatMapDeep([1, 2], duplicate);
         * // => [1, 1, 2, 2]
         */
        function flatMapDeep(collection, iteratee) {
          return baseFlatten(map(collection, iteratee), INFINITY);
        }

        /**
         * This method is like `_.flatMap` except that it recursively flattens the
         * mapped results up to `depth` times.
         *
         * @static
         * @memberOf _
         * @since 4.7.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} [iteratee=_.identity] The function invoked per iteration.
         * @param {number} [depth=1] The maximum recursion depth.
         * @returns {Array} Returns the new flattened array.
         * @example
         *
         * function duplicate(n) {
         *   return [[[n, n]]];
         * }
         *
         * _.flatMapDepth([1, 2], duplicate, 2);
         * // => [[1, 1], [2, 2]]
         */
        function flatMapDepth(collection, iteratee, depth) {
          depth = depth === undefined$1 ? 1 : toInteger(depth);
          return baseFlatten(map(collection, iteratee), depth);
        }

        /**
         * Iterates over elements of `collection` and invokes `iteratee` for each element.
         * The iteratee is invoked with three arguments: (value, index|key, collection).
         * Iteratee functions may exit iteration early by explicitly returning `false`.
         *
         * **Note:** As with other "Collections" methods, objects with a "length"
         * property are iterated like arrays. To avoid this behavior use `_.forIn`
         * or `_.forOwn` for object iteration.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @alias each
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} [iteratee=_.identity] The function invoked per iteration.
         * @returns {Array|Object} Returns `collection`.
         * @see _.forEachRight
         * @example
         *
         * _.forEach([1, 2], function(value) {
         *   console.log(value);
         * });
         * // => Logs `1` then `2`.
         *
         * _.forEach({ 'a': 1, 'b': 2 }, function(value, key) {
         *   console.log(key);
         * });
         * // => Logs 'a' then 'b' (iteration order is not guaranteed).
         */
        function forEach(collection, iteratee) {
          var func = isArray(collection) ? arrayEach : baseEach;
          return func(collection, getIteratee(iteratee, 3));
        }

        /**
         * This method is like `_.forEach` except that it iterates over elements of
         * `collection` from right to left.
         *
         * @static
         * @memberOf _
         * @since 2.0.0
         * @alias eachRight
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} [iteratee=_.identity] The function invoked per iteration.
         * @returns {Array|Object} Returns `collection`.
         * @see _.forEach
         * @example
         *
         * _.forEachRight([1, 2], function(value) {
         *   console.log(value);
         * });
         * // => Logs `2` then `1`.
         */
        function forEachRight(collection, iteratee) {
          var func = isArray(collection) ? arrayEachRight : baseEachRight;
          return func(collection, getIteratee(iteratee, 3));
        }

        /**
         * Creates an object composed of keys generated from the results of running
         * each element of `collection` thru `iteratee`. The order of grouped values
         * is determined by the order they occur in `collection`. The corresponding
         * value of each key is an array of elements responsible for generating the
         * key. The iteratee is invoked with one argument: (value).
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} [iteratee=_.identity] The iteratee to transform keys.
         * @returns {Object} Returns the composed aggregate object.
         * @example
         *
         * _.groupBy([6.1, 4.2, 6.3], Math.floor);
         * // => { '4': [4.2], '6': [6.1, 6.3] }
         *
         * // The `_.property` iteratee shorthand.
         * _.groupBy(['one', 'two', 'three'], 'length');
         * // => { '3': ['one', 'two'], '5': ['three'] }
         */
        var groupBy = createAggregator(function(result, value, key) {
          if (hasOwnProperty.call(result, key)) {
            result[key].push(value);
          } else {
            baseAssignValue(result, key, [value]);
          }
        });

        /**
         * Checks if `value` is in `collection`. If `collection` is a string, it's
         * checked for a substring of `value`, otherwise
         * [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
         * is used for equality comparisons. If `fromIndex` is negative, it's used as
         * the offset from the end of `collection`.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Collection
         * @param {Array|Object|string} collection The collection to inspect.
         * @param {*} value The value to search for.
         * @param {number} [fromIndex=0] The index to search from.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.reduce`.
         * @returns {boolean} Returns `true` if `value` is found, else `false`.
         * @example
         *
         * _.includes([1, 2, 3], 1);
         * // => true
         *
         * _.includes([1, 2, 3], 1, 2);
         * // => false
         *
         * _.includes({ 'a': 1, 'b': 2 }, 1);
         * // => true
         *
         * _.includes('abcd', 'bc');
         * // => true
         */
        function includes(collection, value, fromIndex, guard) {
          collection = isArrayLike(collection) ? collection : values(collection);
          fromIndex = (fromIndex && !guard) ? toInteger(fromIndex) : 0;

          var length = collection.length;
          if (fromIndex < 0) {
            fromIndex = nativeMax(length + fromIndex, 0);
          }
          return isString(collection)
            ? (fromIndex <= length && collection.indexOf(value, fromIndex) > -1)
            : (!!length && baseIndexOf(collection, value, fromIndex) > -1);
        }

        /**
         * Invokes the method at `path` of each element in `collection`, returning
         * an array of the results of each invoked method. Any additional arguments
         * are provided to each invoked method. If `path` is a function, it's invoked
         * for, and `this` bound to, each element in `collection`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Array|Function|string} path The path of the method to invoke or
         *  the function invoked per iteration.
         * @param {...*} [args] The arguments to invoke each method with.
         * @returns {Array} Returns the array of results.
         * @example
         *
         * _.invokeMap([[5, 1, 7], [3, 2, 1]], 'sort');
         * // => [[1, 5, 7], [1, 2, 3]]
         *
         * _.invokeMap([123, 456], String.prototype.split, '');
         * // => [['1', '2', '3'], ['4', '5', '6']]
         */
        var invokeMap = baseRest(function(collection, path, args) {
          var index = -1,
              isFunc = typeof path == 'function',
              result = isArrayLike(collection) ? Array(collection.length) : [];

          baseEach(collection, function(value) {
            result[++index] = isFunc ? apply(path, value, args) : baseInvoke(value, path, args);
          });
          return result;
        });

        /**
         * Creates an object composed of keys generated from the results of running
         * each element of `collection` thru `iteratee`. The corresponding value of
         * each key is the last element responsible for generating the key. The
         * iteratee is invoked with one argument: (value).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} [iteratee=_.identity] The iteratee to transform keys.
         * @returns {Object} Returns the composed aggregate object.
         * @example
         *
         * var array = [
         *   { 'dir': 'left', 'code': 97 },
         *   { 'dir': 'right', 'code': 100 }
         * ];
         *
         * _.keyBy(array, function(o) {
         *   return String.fromCharCode(o.code);
         * });
         * // => { 'a': { 'dir': 'left', 'code': 97 }, 'd': { 'dir': 'right', 'code': 100 } }
         *
         * _.keyBy(array, 'dir');
         * // => { 'left': { 'dir': 'left', 'code': 97 }, 'right': { 'dir': 'right', 'code': 100 } }
         */
        var keyBy = createAggregator(function(result, value, key) {
          baseAssignValue(result, key, value);
        });

        /**
         * Creates an array of values by running each element in `collection` thru
         * `iteratee`. The iteratee is invoked with three arguments:
         * (value, index|key, collection).
         *
         * Many lodash methods are guarded to work as iteratees for methods like
         * `_.every`, `_.filter`, `_.map`, `_.mapValues`, `_.reject`, and `_.some`.
         *
         * The guarded methods are:
         * `ary`, `chunk`, `curry`, `curryRight`, `drop`, `dropRight`, `every`,
         * `fill`, `invert`, `parseInt`, `random`, `range`, `rangeRight`, `repeat`,
         * `sampleSize`, `slice`, `some`, `sortBy`, `split`, `take`, `takeRight`,
         * `template`, `trim`, `trimEnd`, `trimStart`, and `words`
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} [iteratee=_.identity] The function invoked per iteration.
         * @returns {Array} Returns the new mapped array.
         * @example
         *
         * function square(n) {
         *   return n * n;
         * }
         *
         * _.map([4, 8], square);
         * // => [16, 64]
         *
         * _.map({ 'a': 4, 'b': 8 }, square);
         * // => [16, 64] (iteration order is not guaranteed)
         *
         * var users = [
         *   { 'user': 'barney' },
         *   { 'user': 'fred' }
         * ];
         *
         * // The `_.property` iteratee shorthand.
         * _.map(users, 'user');
         * // => ['barney', 'fred']
         */
        function map(collection, iteratee) {
          var func = isArray(collection) ? arrayMap : baseMap;
          return func(collection, getIteratee(iteratee, 3));
        }

        /**
         * This method is like `_.sortBy` except that it allows specifying the sort
         * orders of the iteratees to sort by. If `orders` is unspecified, all values
         * are sorted in ascending order. Otherwise, specify an order of "desc" for
         * descending or "asc" for ascending sort order of corresponding values.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Array[]|Function[]|Object[]|string[]} [iteratees=[_.identity]]
         *  The iteratees to sort by.
         * @param {string[]} [orders] The sort orders of `iteratees`.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.reduce`.
         * @returns {Array} Returns the new sorted array.
         * @example
         *
         * var users = [
         *   { 'user': 'fred',   'age': 48 },
         *   { 'user': 'barney', 'age': 34 },
         *   { 'user': 'fred',   'age': 40 },
         *   { 'user': 'barney', 'age': 36 }
         * ];
         *
         * // Sort by `user` in ascending order and by `age` in descending order.
         * _.orderBy(users, ['user', 'age'], ['asc', 'desc']);
         * // => objects for [['barney', 36], ['barney', 34], ['fred', 48], ['fred', 40]]
         */
        function orderBy(collection, iteratees, orders, guard) {
          if (collection == null) {
            return [];
          }
          if (!isArray(iteratees)) {
            iteratees = iteratees == null ? [] : [iteratees];
          }
          orders = guard ? undefined$1 : orders;
          if (!isArray(orders)) {
            orders = orders == null ? [] : [orders];
          }
          return baseOrderBy(collection, iteratees, orders);
        }

        /**
         * Creates an array of elements split into two groups, the first of which
         * contains elements `predicate` returns truthy for, the second of which
         * contains elements `predicate` returns falsey for. The predicate is
         * invoked with one argument: (value).
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} [predicate=_.identity] The function invoked per iteration.
         * @returns {Array} Returns the array of grouped elements.
         * @example
         *
         * var users = [
         *   { 'user': 'barney',  'age': 36, 'active': false },
         *   { 'user': 'fred',    'age': 40, 'active': true },
         *   { 'user': 'pebbles', 'age': 1,  'active': false }
         * ];
         *
         * _.partition(users, function(o) { return o.active; });
         * // => objects for [['fred'], ['barney', 'pebbles']]
         *
         * // The `_.matches` iteratee shorthand.
         * _.partition(users, { 'age': 1, 'active': false });
         * // => objects for [['pebbles'], ['barney', 'fred']]
         *
         * // The `_.matchesProperty` iteratee shorthand.
         * _.partition(users, ['active', false]);
         * // => objects for [['barney', 'pebbles'], ['fred']]
         *
         * // The `_.property` iteratee shorthand.
         * _.partition(users, 'active');
         * // => objects for [['fred'], ['barney', 'pebbles']]
         */
        var partition = createAggregator(function(result, value, key) {
          result[key ? 0 : 1].push(value);
        }, function() { return [[], []]; });

        /**
         * Reduces `collection` to a value which is the accumulated result of running
         * each element in `collection` thru `iteratee`, where each successive
         * invocation is supplied the return value of the previous. If `accumulator`
         * is not given, the first element of `collection` is used as the initial
         * value. The iteratee is invoked with four arguments:
         * (accumulator, value, index|key, collection).
         *
         * Many lodash methods are guarded to work as iteratees for methods like
         * `_.reduce`, `_.reduceRight`, and `_.transform`.
         *
         * The guarded methods are:
         * `assign`, `defaults`, `defaultsDeep`, `includes`, `merge`, `orderBy`,
         * and `sortBy`
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} [iteratee=_.identity] The function invoked per iteration.
         * @param {*} [accumulator] The initial value.
         * @returns {*} Returns the accumulated value.
         * @see _.reduceRight
         * @example
         *
         * _.reduce([1, 2], function(sum, n) {
         *   return sum + n;
         * }, 0);
         * // => 3
         *
         * _.reduce({ 'a': 1, 'b': 2, 'c': 1 }, function(result, value, key) {
         *   (result[value] || (result[value] = [])).push(key);
         *   return result;
         * }, {});
         * // => { '1': ['a', 'c'], '2': ['b'] } (iteration order is not guaranteed)
         */
        function reduce(collection, iteratee, accumulator) {
          var func = isArray(collection) ? arrayReduce : baseReduce,
              initAccum = arguments.length < 3;

          return func(collection, getIteratee(iteratee, 4), accumulator, initAccum, baseEach);
        }

        /**
         * This method is like `_.reduce` except that it iterates over elements of
         * `collection` from right to left.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} [iteratee=_.identity] The function invoked per iteration.
         * @param {*} [accumulator] The initial value.
         * @returns {*} Returns the accumulated value.
         * @see _.reduce
         * @example
         *
         * var array = [[0, 1], [2, 3], [4, 5]];
         *
         * _.reduceRight(array, function(flattened, other) {
         *   return flattened.concat(other);
         * }, []);
         * // => [4, 5, 2, 3, 0, 1]
         */
        function reduceRight(collection, iteratee, accumulator) {
          var func = isArray(collection) ? arrayReduceRight : baseReduce,
              initAccum = arguments.length < 3;

          return func(collection, getIteratee(iteratee, 4), accumulator, initAccum, baseEachRight);
        }

        /**
         * The opposite of `_.filter`; this method returns the elements of `collection`
         * that `predicate` does **not** return truthy for.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} [predicate=_.identity] The function invoked per iteration.
         * @returns {Array} Returns the new filtered array.
         * @see _.filter
         * @example
         *
         * var users = [
         *   { 'user': 'barney', 'age': 36, 'active': false },
         *   { 'user': 'fred',   'age': 40, 'active': true }
         * ];
         *
         * _.reject(users, function(o) { return !o.active; });
         * // => objects for ['fred']
         *
         * // The `_.matches` iteratee shorthand.
         * _.reject(users, { 'age': 40, 'active': true });
         * // => objects for ['barney']
         *
         * // The `_.matchesProperty` iteratee shorthand.
         * _.reject(users, ['active', false]);
         * // => objects for ['fred']
         *
         * // The `_.property` iteratee shorthand.
         * _.reject(users, 'active');
         * // => objects for ['barney']
         */
        function reject(collection, predicate) {
          var func = isArray(collection) ? arrayFilter : baseFilter;
          return func(collection, negate(getIteratee(predicate, 3)));
        }

        /**
         * Gets a random element from `collection`.
         *
         * @static
         * @memberOf _
         * @since 2.0.0
         * @category Collection
         * @param {Array|Object} collection The collection to sample.
         * @returns {*} Returns the random element.
         * @example
         *
         * _.sample([1, 2, 3, 4]);
         * // => 2
         */
        function sample(collection) {
          var func = isArray(collection) ? arraySample : baseSample;
          return func(collection);
        }

        /**
         * Gets `n` random elements at unique keys from `collection` up to the
         * size of `collection`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Collection
         * @param {Array|Object} collection The collection to sample.
         * @param {number} [n=1] The number of elements to sample.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {Array} Returns the random elements.
         * @example
         *
         * _.sampleSize([1, 2, 3], 2);
         * // => [3, 1]
         *
         * _.sampleSize([1, 2, 3], 4);
         * // => [2, 3, 1]
         */
        function sampleSize(collection, n, guard) {
          if ((guard ? isIterateeCall(collection, n, guard) : n === undefined$1)) {
            n = 1;
          } else {
            n = toInteger(n);
          }
          var func = isArray(collection) ? arraySampleSize : baseSampleSize;
          return func(collection, n);
        }

        /**
         * Creates an array of shuffled values, using a version of the
         * [Fisher-Yates shuffle](https://en.wikipedia.org/wiki/Fisher-Yates_shuffle).
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Collection
         * @param {Array|Object} collection The collection to shuffle.
         * @returns {Array} Returns the new shuffled array.
         * @example
         *
         * _.shuffle([1, 2, 3, 4]);
         * // => [4, 1, 3, 2]
         */
        function shuffle(collection) {
          var func = isArray(collection) ? arrayShuffle : baseShuffle;
          return func(collection);
        }

        /**
         * Gets the size of `collection` by returning its length for array-like
         * values or the number of own enumerable string keyed properties for objects.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Collection
         * @param {Array|Object|string} collection The collection to inspect.
         * @returns {number} Returns the collection size.
         * @example
         *
         * _.size([1, 2, 3]);
         * // => 3
         *
         * _.size({ 'a': 1, 'b': 2 });
         * // => 2
         *
         * _.size('pebbles');
         * // => 7
         */
        function size(collection) {
          if (collection == null) {
            return 0;
          }
          if (isArrayLike(collection)) {
            return isString(collection) ? stringSize(collection) : collection.length;
          }
          var tag = getTag(collection);
          if (tag == mapTag || tag == setTag) {
            return collection.size;
          }
          return baseKeys(collection).length;
        }

        /**
         * Checks if `predicate` returns truthy for **any** element of `collection`.
         * Iteration is stopped once `predicate` returns truthy. The predicate is
         * invoked with three arguments: (value, index|key, collection).
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {Function} [predicate=_.identity] The function invoked per iteration.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {boolean} Returns `true` if any element passes the predicate check,
         *  else `false`.
         * @example
         *
         * _.some([null, 0, 'yes', false], Boolean);
         * // => true
         *
         * var users = [
         *   { 'user': 'barney', 'active': true },
         *   { 'user': 'fred',   'active': false }
         * ];
         *
         * // The `_.matches` iteratee shorthand.
         * _.some(users, { 'user': 'barney', 'active': false });
         * // => false
         *
         * // The `_.matchesProperty` iteratee shorthand.
         * _.some(users, ['active', false]);
         * // => true
         *
         * // The `_.property` iteratee shorthand.
         * _.some(users, 'active');
         * // => true
         */
        function some(collection, predicate, guard) {
          var func = isArray(collection) ? arraySome : baseSome;
          if (guard && isIterateeCall(collection, predicate, guard)) {
            predicate = undefined$1;
          }
          return func(collection, getIteratee(predicate, 3));
        }

        /**
         * Creates an array of elements, sorted in ascending order by the results of
         * running each element in a collection thru each iteratee. This method
         * performs a stable sort, that is, it preserves the original sort order of
         * equal elements. The iteratees are invoked with one argument: (value).
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Collection
         * @param {Array|Object} collection The collection to iterate over.
         * @param {...(Function|Function[])} [iteratees=[_.identity]]
         *  The iteratees to sort by.
         * @returns {Array} Returns the new sorted array.
         * @example
         *
         * var users = [
         *   { 'user': 'fred',   'age': 48 },
         *   { 'user': 'barney', 'age': 36 },
         *   { 'user': 'fred',   'age': 30 },
         *   { 'user': 'barney', 'age': 34 }
         * ];
         *
         * _.sortBy(users, [function(o) { return o.user; }]);
         * // => objects for [['barney', 36], ['barney', 34], ['fred', 48], ['fred', 30]]
         *
         * _.sortBy(users, ['user', 'age']);
         * // => objects for [['barney', 34], ['barney', 36], ['fred', 30], ['fred', 48]]
         */
        var sortBy = baseRest(function(collection, iteratees) {
          if (collection == null) {
            return [];
          }
          var length = iteratees.length;
          if (length > 1 && isIterateeCall(collection, iteratees[0], iteratees[1])) {
            iteratees = [];
          } else if (length > 2 && isIterateeCall(iteratees[0], iteratees[1], iteratees[2])) {
            iteratees = [iteratees[0]];
          }
          return baseOrderBy(collection, baseFlatten(iteratees, 1), []);
        });

        /*------------------------------------------------------------------------*/

        /**
         * Gets the timestamp of the number of milliseconds that have elapsed since
         * the Unix epoch (1 January 1970 00:00:00 UTC).
         *
         * @static
         * @memberOf _
         * @since 2.4.0
         * @category Date
         * @returns {number} Returns the timestamp.
         * @example
         *
         * _.defer(function(stamp) {
         *   console.log(_.now() - stamp);
         * }, _.now());
         * // => Logs the number of milliseconds it took for the deferred invocation.
         */
        var now = ctxNow || function() {
          return root.Date.now();
        };

        /*------------------------------------------------------------------------*/

        /**
         * The opposite of `_.before`; this method creates a function that invokes
         * `func` once it's called `n` or more times.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Function
         * @param {number} n The number of calls before `func` is invoked.
         * @param {Function} func The function to restrict.
         * @returns {Function} Returns the new restricted function.
         * @example
         *
         * var saves = ['profile', 'settings'];
         *
         * var done = _.after(saves.length, function() {
         *   console.log('done saving!');
         * });
         *
         * _.forEach(saves, function(type) {
         *   asyncSave({ 'type': type, 'complete': done });
         * });
         * // => Logs 'done saving!' after the two async saves have completed.
         */
        function after(n, func) {
          if (typeof func != 'function') {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          n = toInteger(n);
          return function() {
            if (--n < 1) {
              return func.apply(this, arguments);
            }
          };
        }

        /**
         * Creates a function that invokes `func`, with up to `n` arguments,
         * ignoring any additional arguments.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Function
         * @param {Function} func The function to cap arguments for.
         * @param {number} [n=func.length] The arity cap.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {Function} Returns the new capped function.
         * @example
         *
         * _.map(['6', '8', '10'], _.ary(parseInt, 1));
         * // => [6, 8, 10]
         */
        function ary(func, n, guard) {
          n = guard ? undefined$1 : n;
          n = (func && n == null) ? func.length : n;
          return createWrap(func, WRAP_ARY_FLAG, undefined$1, undefined$1, undefined$1, undefined$1, n);
        }

        /**
         * Creates a function that invokes `func`, with the `this` binding and arguments
         * of the created function, while it's called less than `n` times. Subsequent
         * calls to the created function return the result of the last `func` invocation.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Function
         * @param {number} n The number of calls at which `func` is no longer invoked.
         * @param {Function} func The function to restrict.
         * @returns {Function} Returns the new restricted function.
         * @example
         *
         * jQuery(element).on('click', _.before(5, addContactToList));
         * // => Allows adding up to 4 contacts to the list.
         */
        function before(n, func) {
          var result;
          if (typeof func != 'function') {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          n = toInteger(n);
          return function() {
            if (--n > 0) {
              result = func.apply(this, arguments);
            }
            if (n <= 1) {
              func = undefined$1;
            }
            return result;
          };
        }

        /**
         * Creates a function that invokes `func` with the `this` binding of `thisArg`
         * and `partials` prepended to the arguments it receives.
         *
         * The `_.bind.placeholder` value, which defaults to `_` in monolithic builds,
         * may be used as a placeholder for partially applied arguments.
         *
         * **Note:** Unlike native `Function#bind`, this method doesn't set the "length"
         * property of bound functions.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Function
         * @param {Function} func The function to bind.
         * @param {*} thisArg The `this` binding of `func`.
         * @param {...*} [partials] The arguments to be partially applied.
         * @returns {Function} Returns the new bound function.
         * @example
         *
         * function greet(greeting, punctuation) {
         *   return greeting + ' ' + this.user + punctuation;
         * }
         *
         * var object = { 'user': 'fred' };
         *
         * var bound = _.bind(greet, object, 'hi');
         * bound('!');
         * // => 'hi fred!'
         *
         * // Bound with placeholders.
         * var bound = _.bind(greet, object, _, '!');
         * bound('hi');
         * // => 'hi fred!'
         */
        var bind = baseRest(function(func, thisArg, partials) {
          var bitmask = WRAP_BIND_FLAG;
          if (partials.length) {
            var holders = replaceHolders(partials, getHolder(bind));
            bitmask |= WRAP_PARTIAL_FLAG;
          }
          return createWrap(func, bitmask, thisArg, partials, holders);
        });

        /**
         * Creates a function that invokes the method at `object[key]` with `partials`
         * prepended to the arguments it receives.
         *
         * This method differs from `_.bind` by allowing bound functions to reference
         * methods that may be redefined or don't yet exist. See
         * [Peter Michaux's article](http://peter.michaux.ca/articles/lazy-function-definition-pattern)
         * for more details.
         *
         * The `_.bindKey.placeholder` value, which defaults to `_` in monolithic
         * builds, may be used as a placeholder for partially applied arguments.
         *
         * @static
         * @memberOf _
         * @since 0.10.0
         * @category Function
         * @param {Object} object The object to invoke the method on.
         * @param {string} key The key of the method.
         * @param {...*} [partials] The arguments to be partially applied.
         * @returns {Function} Returns the new bound function.
         * @example
         *
         * var object = {
         *   'user': 'fred',
         *   'greet': function(greeting, punctuation) {
         *     return greeting + ' ' + this.user + punctuation;
         *   }
         * };
         *
         * var bound = _.bindKey(object, 'greet', 'hi');
         * bound('!');
         * // => 'hi fred!'
         *
         * object.greet = function(greeting, punctuation) {
         *   return greeting + 'ya ' + this.user + punctuation;
         * };
         *
         * bound('!');
         * // => 'hiya fred!'
         *
         * // Bound with placeholders.
         * var bound = _.bindKey(object, 'greet', _, '!');
         * bound('hi');
         * // => 'hiya fred!'
         */
        var bindKey = baseRest(function(object, key, partials) {
          var bitmask = WRAP_BIND_FLAG | WRAP_BIND_KEY_FLAG;
          if (partials.length) {
            var holders = replaceHolders(partials, getHolder(bindKey));
            bitmask |= WRAP_PARTIAL_FLAG;
          }
          return createWrap(key, bitmask, object, partials, holders);
        });

        /**
         * Creates a function that accepts arguments of `func` and either invokes
         * `func` returning its result, if at least `arity` number of arguments have
         * been provided, or returns a function that accepts the remaining `func`
         * arguments, and so on. The arity of `func` may be specified if `func.length`
         * is not sufficient.
         *
         * The `_.curry.placeholder` value, which defaults to `_` in monolithic builds,
         * may be used as a placeholder for provided arguments.
         *
         * **Note:** This method doesn't set the "length" property of curried functions.
         *
         * @static
         * @memberOf _
         * @since 2.0.0
         * @category Function
         * @param {Function} func The function to curry.
         * @param {number} [arity=func.length] The arity of `func`.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {Function} Returns the new curried function.
         * @example
         *
         * var abc = function(a, b, c) {
         *   return [a, b, c];
         * };
         *
         * var curried = _.curry(abc);
         *
         * curried(1)(2)(3);
         * // => [1, 2, 3]
         *
         * curried(1, 2)(3);
         * // => [1, 2, 3]
         *
         * curried(1, 2, 3);
         * // => [1, 2, 3]
         *
         * // Curried with placeholders.
         * curried(1)(_, 3)(2);
         * // => [1, 2, 3]
         */
        function curry(func, arity, guard) {
          arity = guard ? undefined$1 : arity;
          var result = createWrap(func, WRAP_CURRY_FLAG, undefined$1, undefined$1, undefined$1, undefined$1, undefined$1, arity);
          result.placeholder = curry.placeholder;
          return result;
        }

        /**
         * This method is like `_.curry` except that arguments are applied to `func`
         * in the manner of `_.partialRight` instead of `_.partial`.
         *
         * The `_.curryRight.placeholder` value, which defaults to `_` in monolithic
         * builds, may be used as a placeholder for provided arguments.
         *
         * **Note:** This method doesn't set the "length" property of curried functions.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Function
         * @param {Function} func The function to curry.
         * @param {number} [arity=func.length] The arity of `func`.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {Function} Returns the new curried function.
         * @example
         *
         * var abc = function(a, b, c) {
         *   return [a, b, c];
         * };
         *
         * var curried = _.curryRight(abc);
         *
         * curried(3)(2)(1);
         * // => [1, 2, 3]
         *
         * curried(2, 3)(1);
         * // => [1, 2, 3]
         *
         * curried(1, 2, 3);
         * // => [1, 2, 3]
         *
         * // Curried with placeholders.
         * curried(3)(1, _)(2);
         * // => [1, 2, 3]
         */
        function curryRight(func, arity, guard) {
          arity = guard ? undefined$1 : arity;
          var result = createWrap(func, WRAP_CURRY_RIGHT_FLAG, undefined$1, undefined$1, undefined$1, undefined$1, undefined$1, arity);
          result.placeholder = curryRight.placeholder;
          return result;
        }

        /**
         * Creates a debounced function that delays invoking `func` until after `wait`
         * milliseconds have elapsed since the last time the debounced function was
         * invoked. The debounced function comes with a `cancel` method to cancel
         * delayed `func` invocations and a `flush` method to immediately invoke them.
         * Provide `options` to indicate whether `func` should be invoked on the
         * leading and/or trailing edge of the `wait` timeout. The `func` is invoked
         * with the last arguments provided to the debounced function. Subsequent
         * calls to the debounced function return the result of the last `func`
         * invocation.
         *
         * **Note:** If `leading` and `trailing` options are `true`, `func` is
         * invoked on the trailing edge of the timeout only if the debounced function
         * is invoked more than once during the `wait` timeout.
         *
         * If `wait` is `0` and `leading` is `false`, `func` invocation is deferred
         * until to the next tick, similar to `setTimeout` with a timeout of `0`.
         *
         * See [David Corbacho's article](https://css-tricks.com/debouncing-throttling-explained-examples/)
         * for details over the differences between `_.debounce` and `_.throttle`.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Function
         * @param {Function} func The function to debounce.
         * @param {number} [wait=0] The number of milliseconds to delay.
         * @param {Object} [options={}] The options object.
         * @param {boolean} [options.leading=false]
         *  Specify invoking on the leading edge of the timeout.
         * @param {number} [options.maxWait]
         *  The maximum time `func` is allowed to be delayed before it's invoked.
         * @param {boolean} [options.trailing=true]
         *  Specify invoking on the trailing edge of the timeout.
         * @returns {Function} Returns the new debounced function.
         * @example
         *
         * // Avoid costly calculations while the window size is in flux.
         * jQuery(window).on('resize', _.debounce(calculateLayout, 150));
         *
         * // Invoke `sendMail` when clicked, debouncing subsequent calls.
         * jQuery(element).on('click', _.debounce(sendMail, 300, {
         *   'leading': true,
         *   'trailing': false
         * }));
         *
         * // Ensure `batchLog` is invoked once after 1 second of debounced calls.
         * var debounced = _.debounce(batchLog, 250, { 'maxWait': 1000 });
         * var source = new EventSource('/stream');
         * jQuery(source).on('message', debounced);
         *
         * // Cancel the trailing debounced invocation.
         * jQuery(window).on('popstate', debounced.cancel);
         */
        function debounce(func, wait, options) {
          var lastArgs,
              lastThis,
              maxWait,
              result,
              timerId,
              lastCallTime,
              lastInvokeTime = 0,
              leading = false,
              maxing = false,
              trailing = true;

          if (typeof func != 'function') {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          wait = toNumber(wait) || 0;
          if (isObject(options)) {
            leading = !!options.leading;
            maxing = 'maxWait' in options;
            maxWait = maxing ? nativeMax(toNumber(options.maxWait) || 0, wait) : maxWait;
            trailing = 'trailing' in options ? !!options.trailing : trailing;
          }

          function invokeFunc(time) {
            var args = lastArgs,
                thisArg = lastThis;

            lastArgs = lastThis = undefined$1;
            lastInvokeTime = time;
            result = func.apply(thisArg, args);
            return result;
          }

          function leadingEdge(time) {
            // Reset any `maxWait` timer.
            lastInvokeTime = time;
            // Start the timer for the trailing edge.
            timerId = setTimeout(timerExpired, wait);
            // Invoke the leading edge.
            return leading ? invokeFunc(time) : result;
          }

          function remainingWait(time) {
            var timeSinceLastCall = time - lastCallTime,
                timeSinceLastInvoke = time - lastInvokeTime,
                timeWaiting = wait - timeSinceLastCall;

            return maxing
              ? nativeMin(timeWaiting, maxWait - timeSinceLastInvoke)
              : timeWaiting;
          }

          function shouldInvoke(time) {
            var timeSinceLastCall = time - lastCallTime,
                timeSinceLastInvoke = time - lastInvokeTime;

            // Either this is the first call, activity has stopped and we're at the
            // trailing edge, the system time has gone backwards and we're treating
            // it as the trailing edge, or we've hit the `maxWait` limit.
            return (lastCallTime === undefined$1 || (timeSinceLastCall >= wait) ||
              (timeSinceLastCall < 0) || (maxing && timeSinceLastInvoke >= maxWait));
          }

          function timerExpired() {
            var time = now();
            if (shouldInvoke(time)) {
              return trailingEdge(time);
            }
            // Restart the timer.
            timerId = setTimeout(timerExpired, remainingWait(time));
          }

          function trailingEdge(time) {
            timerId = undefined$1;

            // Only invoke if we have `lastArgs` which means `func` has been
            // debounced at least once.
            if (trailing && lastArgs) {
              return invokeFunc(time);
            }
            lastArgs = lastThis = undefined$1;
            return result;
          }

          function cancel() {
            if (timerId !== undefined$1) {
              clearTimeout(timerId);
            }
            lastInvokeTime = 0;
            lastArgs = lastCallTime = lastThis = timerId = undefined$1;
          }

          function flush() {
            return timerId === undefined$1 ? result : trailingEdge(now());
          }

          function debounced() {
            var time = now(),
                isInvoking = shouldInvoke(time);

            lastArgs = arguments;
            lastThis = this;
            lastCallTime = time;

            if (isInvoking) {
              if (timerId === undefined$1) {
                return leadingEdge(lastCallTime);
              }
              if (maxing) {
                // Handle invocations in a tight loop.
                clearTimeout(timerId);
                timerId = setTimeout(timerExpired, wait);
                return invokeFunc(lastCallTime);
              }
            }
            if (timerId === undefined$1) {
              timerId = setTimeout(timerExpired, wait);
            }
            return result;
          }
          debounced.cancel = cancel;
          debounced.flush = flush;
          return debounced;
        }

        /**
         * Defers invoking the `func` until the current call stack has cleared. Any
         * additional arguments are provided to `func` when it's invoked.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Function
         * @param {Function} func The function to defer.
         * @param {...*} [args] The arguments to invoke `func` with.
         * @returns {number} Returns the timer id.
         * @example
         *
         * _.defer(function(text) {
         *   console.log(text);
         * }, 'deferred');
         * // => Logs 'deferred' after one millisecond.
         */
        var defer = baseRest(function(func, args) {
          return baseDelay(func, 1, args);
        });

        /**
         * Invokes `func` after `wait` milliseconds. Any additional arguments are
         * provided to `func` when it's invoked.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Function
         * @param {Function} func The function to delay.
         * @param {number} wait The number of milliseconds to delay invocation.
         * @param {...*} [args] The arguments to invoke `func` with.
         * @returns {number} Returns the timer id.
         * @example
         *
         * _.delay(function(text) {
         *   console.log(text);
         * }, 1000, 'later');
         * // => Logs 'later' after one second.
         */
        var delay = baseRest(function(func, wait, args) {
          return baseDelay(func, toNumber(wait) || 0, args);
        });

        /**
         * Creates a function that invokes `func` with arguments reversed.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Function
         * @param {Function} func The function to flip arguments for.
         * @returns {Function} Returns the new flipped function.
         * @example
         *
         * var flipped = _.flip(function() {
         *   return _.toArray(arguments);
         * });
         *
         * flipped('a', 'b', 'c', 'd');
         * // => ['d', 'c', 'b', 'a']
         */
        function flip(func) {
          return createWrap(func, WRAP_FLIP_FLAG);
        }

        /**
         * Creates a function that memoizes the result of `func`. If `resolver` is
         * provided, it determines the cache key for storing the result based on the
         * arguments provided to the memoized function. By default, the first argument
         * provided to the memoized function is used as the map cache key. The `func`
         * is invoked with the `this` binding of the memoized function.
         *
         * **Note:** The cache is exposed as the `cache` property on the memoized
         * function. Its creation may be customized by replacing the `_.memoize.Cache`
         * constructor with one whose instances implement the
         * [`Map`](http://ecma-international.org/ecma-262/7.0/#sec-properties-of-the-map-prototype-object)
         * method interface of `clear`, `delete`, `get`, `has`, and `set`.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Function
         * @param {Function} func The function to have its output memoized.
         * @param {Function} [resolver] The function to resolve the cache key.
         * @returns {Function} Returns the new memoized function.
         * @example
         *
         * var object = { 'a': 1, 'b': 2 };
         * var other = { 'c': 3, 'd': 4 };
         *
         * var values = _.memoize(_.values);
         * values(object);
         * // => [1, 2]
         *
         * values(other);
         * // => [3, 4]
         *
         * object.a = 2;
         * values(object);
         * // => [1, 2]
         *
         * // Modify the result cache.
         * values.cache.set(object, ['a', 'b']);
         * values(object);
         * // => ['a', 'b']
         *
         * // Replace `_.memoize.Cache`.
         * _.memoize.Cache = WeakMap;
         */
        function memoize(func, resolver) {
          if (typeof func != 'function' || (resolver != null && typeof resolver != 'function')) {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          var memoized = function() {
            var args = arguments,
                key = resolver ? resolver.apply(this, args) : args[0],
                cache = memoized.cache;

            if (cache.has(key)) {
              return cache.get(key);
            }
            var result = func.apply(this, args);
            memoized.cache = cache.set(key, result) || cache;
            return result;
          };
          memoized.cache = new (memoize.Cache || MapCache);
          return memoized;
        }

        // Expose `MapCache`.
        memoize.Cache = MapCache;

        /**
         * Creates a function that negates the result of the predicate `func`. The
         * `func` predicate is invoked with the `this` binding and arguments of the
         * created function.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Function
         * @param {Function} predicate The predicate to negate.
         * @returns {Function} Returns the new negated function.
         * @example
         *
         * function isEven(n) {
         *   return n % 2 == 0;
         * }
         *
         * _.filter([1, 2, 3, 4, 5, 6], _.negate(isEven));
         * // => [1, 3, 5]
         */
        function negate(predicate) {
          if (typeof predicate != 'function') {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          return function() {
            var args = arguments;
            switch (args.length) {
              case 0: return !predicate.call(this);
              case 1: return !predicate.call(this, args[0]);
              case 2: return !predicate.call(this, args[0], args[1]);
              case 3: return !predicate.call(this, args[0], args[1], args[2]);
            }
            return !predicate.apply(this, args);
          };
        }

        /**
         * Creates a function that is restricted to invoking `func` once. Repeat calls
         * to the function return the value of the first invocation. The `func` is
         * invoked with the `this` binding and arguments of the created function.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Function
         * @param {Function} func The function to restrict.
         * @returns {Function} Returns the new restricted function.
         * @example
         *
         * var initialize = _.once(createApplication);
         * initialize();
         * initialize();
         * // => `createApplication` is invoked once
         */
        function once(func) {
          return before(2, func);
        }

        /**
         * Creates a function that invokes `func` with its arguments transformed.
         *
         * @static
         * @since 4.0.0
         * @memberOf _
         * @category Function
         * @param {Function} func The function to wrap.
         * @param {...(Function|Function[])} [transforms=[_.identity]]
         *  The argument transforms.
         * @returns {Function} Returns the new function.
         * @example
         *
         * function doubled(n) {
         *   return n * 2;
         * }
         *
         * function square(n) {
         *   return n * n;
         * }
         *
         * var func = _.overArgs(function(x, y) {
         *   return [x, y];
         * }, [square, doubled]);
         *
         * func(9, 3);
         * // => [81, 6]
         *
         * func(10, 5);
         * // => [100, 10]
         */
        var overArgs = castRest(function(func, transforms) {
          transforms = (transforms.length == 1 && isArray(transforms[0]))
            ? arrayMap(transforms[0], baseUnary(getIteratee()))
            : arrayMap(baseFlatten(transforms, 1), baseUnary(getIteratee()));

          var funcsLength = transforms.length;
          return baseRest(function(args) {
            var index = -1,
                length = nativeMin(args.length, funcsLength);

            while (++index < length) {
              args[index] = transforms[index].call(this, args[index]);
            }
            return apply(func, this, args);
          });
        });

        /**
         * Creates a function that invokes `func` with `partials` prepended to the
         * arguments it receives. This method is like `_.bind` except it does **not**
         * alter the `this` binding.
         *
         * The `_.partial.placeholder` value, which defaults to `_` in monolithic
         * builds, may be used as a placeholder for partially applied arguments.
         *
         * **Note:** This method doesn't set the "length" property of partially
         * applied functions.
         *
         * @static
         * @memberOf _
         * @since 0.2.0
         * @category Function
         * @param {Function} func The function to partially apply arguments to.
         * @param {...*} [partials] The arguments to be partially applied.
         * @returns {Function} Returns the new partially applied function.
         * @example
         *
         * function greet(greeting, name) {
         *   return greeting + ' ' + name;
         * }
         *
         * var sayHelloTo = _.partial(greet, 'hello');
         * sayHelloTo('fred');
         * // => 'hello fred'
         *
         * // Partially applied with placeholders.
         * var greetFred = _.partial(greet, _, 'fred');
         * greetFred('hi');
         * // => 'hi fred'
         */
        var partial = baseRest(function(func, partials) {
          var holders = replaceHolders(partials, getHolder(partial));
          return createWrap(func, WRAP_PARTIAL_FLAG, undefined$1, partials, holders);
        });

        /**
         * This method is like `_.partial` except that partially applied arguments
         * are appended to the arguments it receives.
         *
         * The `_.partialRight.placeholder` value, which defaults to `_` in monolithic
         * builds, may be used as a placeholder for partially applied arguments.
         *
         * **Note:** This method doesn't set the "length" property of partially
         * applied functions.
         *
         * @static
         * @memberOf _
         * @since 1.0.0
         * @category Function
         * @param {Function} func The function to partially apply arguments to.
         * @param {...*} [partials] The arguments to be partially applied.
         * @returns {Function} Returns the new partially applied function.
         * @example
         *
         * function greet(greeting, name) {
         *   return greeting + ' ' + name;
         * }
         *
         * var greetFred = _.partialRight(greet, 'fred');
         * greetFred('hi');
         * // => 'hi fred'
         *
         * // Partially applied with placeholders.
         * var sayHelloTo = _.partialRight(greet, 'hello', _);
         * sayHelloTo('fred');
         * // => 'hello fred'
         */
        var partialRight = baseRest(function(func, partials) {
          var holders = replaceHolders(partials, getHolder(partialRight));
          return createWrap(func, WRAP_PARTIAL_RIGHT_FLAG, undefined$1, partials, holders);
        });

        /**
         * Creates a function that invokes `func` with arguments arranged according
         * to the specified `indexes` where the argument value at the first index is
         * provided as the first argument, the argument value at the second index is
         * provided as the second argument, and so on.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Function
         * @param {Function} func The function to rearrange arguments for.
         * @param {...(number|number[])} indexes The arranged argument indexes.
         * @returns {Function} Returns the new function.
         * @example
         *
         * var rearged = _.rearg(function(a, b, c) {
         *   return [a, b, c];
         * }, [2, 0, 1]);
         *
         * rearged('b', 'c', 'a')
         * // => ['a', 'b', 'c']
         */
        var rearg = flatRest(function(func, indexes) {
          return createWrap(func, WRAP_REARG_FLAG, undefined$1, undefined$1, undefined$1, indexes);
        });

        /**
         * Creates a function that invokes `func` with the `this` binding of the
         * created function and arguments from `start` and beyond provided as
         * an array.
         *
         * **Note:** This method is based on the
         * [rest parameter](https://mdn.io/rest_parameters).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Function
         * @param {Function} func The function to apply a rest parameter to.
         * @param {number} [start=func.length-1] The start position of the rest parameter.
         * @returns {Function} Returns the new function.
         * @example
         *
         * var say = _.rest(function(what, names) {
         *   return what + ' ' + _.initial(names).join(', ') +
         *     (_.size(names) > 1 ? ', & ' : '') + _.last(names);
         * });
         *
         * say('hello', 'fred', 'barney', 'pebbles');
         * // => 'hello fred, barney, & pebbles'
         */
        function rest(func, start) {
          if (typeof func != 'function') {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          start = start === undefined$1 ? start : toInteger(start);
          return baseRest(func, start);
        }

        /**
         * Creates a function that invokes `func` with the `this` binding of the
         * create function and an array of arguments much like
         * [`Function#apply`](http://www.ecma-international.org/ecma-262/7.0/#sec-function.prototype.apply).
         *
         * **Note:** This method is based on the
         * [spread operator](https://mdn.io/spread_operator).
         *
         * @static
         * @memberOf _
         * @since 3.2.0
         * @category Function
         * @param {Function} func The function to spread arguments over.
         * @param {number} [start=0] The start position of the spread.
         * @returns {Function} Returns the new function.
         * @example
         *
         * var say = _.spread(function(who, what) {
         *   return who + ' says ' + what;
         * });
         *
         * say(['fred', 'hello']);
         * // => 'fred says hello'
         *
         * var numbers = Promise.all([
         *   Promise.resolve(40),
         *   Promise.resolve(36)
         * ]);
         *
         * numbers.then(_.spread(function(x, y) {
         *   return x + y;
         * }));
         * // => a Promise of 76
         */
        function spread(func, start) {
          if (typeof func != 'function') {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          start = start == null ? 0 : nativeMax(toInteger(start), 0);
          return baseRest(function(args) {
            var array = args[start],
                otherArgs = castSlice(args, 0, start);

            if (array) {
              arrayPush(otherArgs, array);
            }
            return apply(func, this, otherArgs);
          });
        }

        /**
         * Creates a throttled function that only invokes `func` at most once per
         * every `wait` milliseconds. The throttled function comes with a `cancel`
         * method to cancel delayed `func` invocations and a `flush` method to
         * immediately invoke them. Provide `options` to indicate whether `func`
         * should be invoked on the leading and/or trailing edge of the `wait`
         * timeout. The `func` is invoked with the last arguments provided to the
         * throttled function. Subsequent calls to the throttled function return the
         * result of the last `func` invocation.
         *
         * **Note:** If `leading` and `trailing` options are `true`, `func` is
         * invoked on the trailing edge of the timeout only if the throttled function
         * is invoked more than once during the `wait` timeout.
         *
         * If `wait` is `0` and `leading` is `false`, `func` invocation is deferred
         * until to the next tick, similar to `setTimeout` with a timeout of `0`.
         *
         * See [David Corbacho's article](https://css-tricks.com/debouncing-throttling-explained-examples/)
         * for details over the differences between `_.throttle` and `_.debounce`.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Function
         * @param {Function} func The function to throttle.
         * @param {number} [wait=0] The number of milliseconds to throttle invocations to.
         * @param {Object} [options={}] The options object.
         * @param {boolean} [options.leading=true]
         *  Specify invoking on the leading edge of the timeout.
         * @param {boolean} [options.trailing=true]
         *  Specify invoking on the trailing edge of the timeout.
         * @returns {Function} Returns the new throttled function.
         * @example
         *
         * // Avoid excessively updating the position while scrolling.
         * jQuery(window).on('scroll', _.throttle(updatePosition, 100));
         *
         * // Invoke `renewToken` when the click event is fired, but not more than once every 5 minutes.
         * var throttled = _.throttle(renewToken, 300000, { 'trailing': false });
         * jQuery(element).on('click', throttled);
         *
         * // Cancel the trailing throttled invocation.
         * jQuery(window).on('popstate', throttled.cancel);
         */
        function throttle(func, wait, options) {
          var leading = true,
              trailing = true;

          if (typeof func != 'function') {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          if (isObject(options)) {
            leading = 'leading' in options ? !!options.leading : leading;
            trailing = 'trailing' in options ? !!options.trailing : trailing;
          }
          return debounce(func, wait, {
            'leading': leading,
            'maxWait': wait,
            'trailing': trailing
          });
        }

        /**
         * Creates a function that accepts up to one argument, ignoring any
         * additional arguments.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Function
         * @param {Function} func The function to cap arguments for.
         * @returns {Function} Returns the new capped function.
         * @example
         *
         * _.map(['6', '8', '10'], _.unary(parseInt));
         * // => [6, 8, 10]
         */
        function unary(func) {
          return ary(func, 1);
        }

        /**
         * Creates a function that provides `value` to `wrapper` as its first
         * argument. Any additional arguments provided to the function are appended
         * to those provided to the `wrapper`. The wrapper is invoked with the `this`
         * binding of the created function.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Function
         * @param {*} value The value to wrap.
         * @param {Function} [wrapper=identity] The wrapper function.
         * @returns {Function} Returns the new function.
         * @example
         *
         * var p = _.wrap(_.escape, function(func, text) {
         *   return '<p>' + func(text) + '</p>';
         * });
         *
         * p('fred, barney, & pebbles');
         * // => '<p>fred, barney, &amp; pebbles</p>'
         */
        function wrap(value, wrapper) {
          return partial(castFunction(wrapper), value);
        }

        /*------------------------------------------------------------------------*/

        /**
         * Casts `value` as an array if it's not one.
         *
         * @static
         * @memberOf _
         * @since 4.4.0
         * @category Lang
         * @param {*} value The value to inspect.
         * @returns {Array} Returns the cast array.
         * @example
         *
         * _.castArray(1);
         * // => [1]
         *
         * _.castArray({ 'a': 1 });
         * // => [{ 'a': 1 }]
         *
         * _.castArray('abc');
         * // => ['abc']
         *
         * _.castArray(null);
         * // => [null]
         *
         * _.castArray(undefined);
         * // => [undefined]
         *
         * _.castArray();
         * // => []
         *
         * var array = [1, 2, 3];
         * console.log(_.castArray(array) === array);
         * // => true
         */
        function castArray() {
          if (!arguments.length) {
            return [];
          }
          var value = arguments[0];
          return isArray(value) ? value : [value];
        }

        /**
         * Creates a shallow clone of `value`.
         *
         * **Note:** This method is loosely based on the
         * [structured clone algorithm](https://mdn.io/Structured_clone_algorithm)
         * and supports cloning arrays, array buffers, booleans, date objects, maps,
         * numbers, `Object` objects, regexes, sets, strings, symbols, and typed
         * arrays. The own enumerable properties of `arguments` objects are cloned
         * as plain objects. An empty object is returned for uncloneable values such
         * as error objects, functions, DOM nodes, and WeakMaps.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Lang
         * @param {*} value The value to clone.
         * @returns {*} Returns the cloned value.
         * @see _.cloneDeep
         * @example
         *
         * var objects = [{ 'a': 1 }, { 'b': 2 }];
         *
         * var shallow = _.clone(objects);
         * console.log(shallow[0] === objects[0]);
         * // => true
         */
        function clone(value) {
          return baseClone(value, CLONE_SYMBOLS_FLAG);
        }

        /**
         * This method is like `_.clone` except that it accepts `customizer` which
         * is invoked to produce the cloned value. If `customizer` returns `undefined`,
         * cloning is handled by the method instead. The `customizer` is invoked with
         * up to four arguments; (value [, index|key, object, stack]).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to clone.
         * @param {Function} [customizer] The function to customize cloning.
         * @returns {*} Returns the cloned value.
         * @see _.cloneDeepWith
         * @example
         *
         * function customizer(value) {
         *   if (_.isElement(value)) {
         *     return value.cloneNode(false);
         *   }
         * }
         *
         * var el = _.cloneWith(document.body, customizer);
         *
         * console.log(el === document.body);
         * // => false
         * console.log(el.nodeName);
         * // => 'BODY'
         * console.log(el.childNodes.length);
         * // => 0
         */
        function cloneWith(value, customizer) {
          customizer = typeof customizer == 'function' ? customizer : undefined$1;
          return baseClone(value, CLONE_SYMBOLS_FLAG, customizer);
        }

        /**
         * This method is like `_.clone` except that it recursively clones `value`.
         *
         * @static
         * @memberOf _
         * @since 1.0.0
         * @category Lang
         * @param {*} value The value to recursively clone.
         * @returns {*} Returns the deep cloned value.
         * @see _.clone
         * @example
         *
         * var objects = [{ 'a': 1 }, { 'b': 2 }];
         *
         * var deep = _.cloneDeep(objects);
         * console.log(deep[0] === objects[0]);
         * // => false
         */
        function cloneDeep(value) {
          return baseClone(value, CLONE_DEEP_FLAG | CLONE_SYMBOLS_FLAG);
        }

        /**
         * This method is like `_.cloneWith` except that it recursively clones `value`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to recursively clone.
         * @param {Function} [customizer] The function to customize cloning.
         * @returns {*} Returns the deep cloned value.
         * @see _.cloneWith
         * @example
         *
         * function customizer(value) {
         *   if (_.isElement(value)) {
         *     return value.cloneNode(true);
         *   }
         * }
         *
         * var el = _.cloneDeepWith(document.body, customizer);
         *
         * console.log(el === document.body);
         * // => false
         * console.log(el.nodeName);
         * // => 'BODY'
         * console.log(el.childNodes.length);
         * // => 20
         */
        function cloneDeepWith(value, customizer) {
          customizer = typeof customizer == 'function' ? customizer : undefined$1;
          return baseClone(value, CLONE_DEEP_FLAG | CLONE_SYMBOLS_FLAG, customizer);
        }

        /**
         * Checks if `object` conforms to `source` by invoking the predicate
         * properties of `source` with the corresponding property values of `object`.
         *
         * **Note:** This method is equivalent to `_.conforms` when `source` is
         * partially applied.
         *
         * @static
         * @memberOf _
         * @since 4.14.0
         * @category Lang
         * @param {Object} object The object to inspect.
         * @param {Object} source The object of property predicates to conform to.
         * @returns {boolean} Returns `true` if `object` conforms, else `false`.
         * @example
         *
         * var object = { 'a': 1, 'b': 2 };
         *
         * _.conformsTo(object, { 'b': function(n) { return n > 1; } });
         * // => true
         *
         * _.conformsTo(object, { 'b': function(n) { return n > 2; } });
         * // => false
         */
        function conformsTo(object, source) {
          return source == null || baseConformsTo(object, source, keys(source));
        }

        /**
         * Performs a
         * [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
         * comparison between two values to determine if they are equivalent.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to compare.
         * @param {*} other The other value to compare.
         * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
         * @example
         *
         * var object = { 'a': 1 };
         * var other = { 'a': 1 };
         *
         * _.eq(object, object);
         * // => true
         *
         * _.eq(object, other);
         * // => false
         *
         * _.eq('a', 'a');
         * // => true
         *
         * _.eq('a', Object('a'));
         * // => false
         *
         * _.eq(NaN, NaN);
         * // => true
         */
        function eq(value, other) {
          return value === other || (value !== value && other !== other);
        }

        /**
         * Checks if `value` is greater than `other`.
         *
         * @static
         * @memberOf _
         * @since 3.9.0
         * @category Lang
         * @param {*} value The value to compare.
         * @param {*} other The other value to compare.
         * @returns {boolean} Returns `true` if `value` is greater than `other`,
         *  else `false`.
         * @see _.lt
         * @example
         *
         * _.gt(3, 1);
         * // => true
         *
         * _.gt(3, 3);
         * // => false
         *
         * _.gt(1, 3);
         * // => false
         */
        var gt = createRelationalOperation(baseGt);

        /**
         * Checks if `value` is greater than or equal to `other`.
         *
         * @static
         * @memberOf _
         * @since 3.9.0
         * @category Lang
         * @param {*} value The value to compare.
         * @param {*} other The other value to compare.
         * @returns {boolean} Returns `true` if `value` is greater than or equal to
         *  `other`, else `false`.
         * @see _.lte
         * @example
         *
         * _.gte(3, 1);
         * // => true
         *
         * _.gte(3, 3);
         * // => true
         *
         * _.gte(1, 3);
         * // => false
         */
        var gte = createRelationalOperation(function(value, other) {
          return value >= other;
        });

        /**
         * Checks if `value` is likely an `arguments` object.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is an `arguments` object,
         *  else `false`.
         * @example
         *
         * _.isArguments(function() { return arguments; }());
         * // => true
         *
         * _.isArguments([1, 2, 3]);
         * // => false
         */
        var isArguments = baseIsArguments(function() { return arguments; }()) ? baseIsArguments : function(value) {
          return isObjectLike(value) && hasOwnProperty.call(value, 'callee') &&
            !propertyIsEnumerable.call(value, 'callee');
        };

        /**
         * Checks if `value` is classified as an `Array` object.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is an array, else `false`.
         * @example
         *
         * _.isArray([1, 2, 3]);
         * // => true
         *
         * _.isArray(document.body.children);
         * // => false
         *
         * _.isArray('abc');
         * // => false
         *
         * _.isArray(_.noop);
         * // => false
         */
        var isArray = Array.isArray;

        /**
         * Checks if `value` is classified as an `ArrayBuffer` object.
         *
         * @static
         * @memberOf _
         * @since 4.3.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is an array buffer, else `false`.
         * @example
         *
         * _.isArrayBuffer(new ArrayBuffer(2));
         * // => true
         *
         * _.isArrayBuffer(new Array(2));
         * // => false
         */
        var isArrayBuffer = nodeIsArrayBuffer ? baseUnary(nodeIsArrayBuffer) : baseIsArrayBuffer;

        /**
         * Checks if `value` is array-like. A value is considered array-like if it's
         * not a function and has a `value.length` that's an integer greater than or
         * equal to `0` and less than or equal to `Number.MAX_SAFE_INTEGER`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is array-like, else `false`.
         * @example
         *
         * _.isArrayLike([1, 2, 3]);
         * // => true
         *
         * _.isArrayLike(document.body.children);
         * // => true
         *
         * _.isArrayLike('abc');
         * // => true
         *
         * _.isArrayLike(_.noop);
         * // => false
         */
        function isArrayLike(value) {
          return value != null && isLength(value.length) && !isFunction(value);
        }

        /**
         * This method is like `_.isArrayLike` except that it also checks if `value`
         * is an object.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is an array-like object,
         *  else `false`.
         * @example
         *
         * _.isArrayLikeObject([1, 2, 3]);
         * // => true
         *
         * _.isArrayLikeObject(document.body.children);
         * // => true
         *
         * _.isArrayLikeObject('abc');
         * // => false
         *
         * _.isArrayLikeObject(_.noop);
         * // => false
         */
        function isArrayLikeObject(value) {
          return isObjectLike(value) && isArrayLike(value);
        }

        /**
         * Checks if `value` is classified as a boolean primitive or object.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a boolean, else `false`.
         * @example
         *
         * _.isBoolean(false);
         * // => true
         *
         * _.isBoolean(null);
         * // => false
         */
        function isBoolean(value) {
          return value === true || value === false ||
            (isObjectLike(value) && baseGetTag(value) == boolTag);
        }

        /**
         * Checks if `value` is a buffer.
         *
         * @static
         * @memberOf _
         * @since 4.3.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a buffer, else `false`.
         * @example
         *
         * _.isBuffer(new Buffer(2));
         * // => true
         *
         * _.isBuffer(new Uint8Array(2));
         * // => false
         */
        var isBuffer = nativeIsBuffer || stubFalse;

        /**
         * Checks if `value` is classified as a `Date` object.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a date object, else `false`.
         * @example
         *
         * _.isDate(new Date);
         * // => true
         *
         * _.isDate('Mon April 23 2012');
         * // => false
         */
        var isDate = nodeIsDate ? baseUnary(nodeIsDate) : baseIsDate;

        /**
         * Checks if `value` is likely a DOM element.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a DOM element, else `false`.
         * @example
         *
         * _.isElement(document.body);
         * // => true
         *
         * _.isElement('<body>');
         * // => false
         */
        function isElement(value) {
          return isObjectLike(value) && value.nodeType === 1 && !isPlainObject(value);
        }

        /**
         * Checks if `value` is an empty object, collection, map, or set.
         *
         * Objects are considered empty if they have no own enumerable string keyed
         * properties.
         *
         * Array-like values such as `arguments` objects, arrays, buffers, strings, or
         * jQuery-like collections are considered empty if they have a `length` of `0`.
         * Similarly, maps and sets are considered empty if they have a `size` of `0`.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is empty, else `false`.
         * @example
         *
         * _.isEmpty(null);
         * // => true
         *
         * _.isEmpty(true);
         * // => true
         *
         * _.isEmpty(1);
         * // => true
         *
         * _.isEmpty([1, 2, 3]);
         * // => false
         *
         * _.isEmpty({ 'a': 1 });
         * // => false
         */
        function isEmpty(value) {
          if (value == null) {
            return true;
          }
          if (isArrayLike(value) &&
              (isArray(value) || typeof value == 'string' || typeof value.splice == 'function' ||
                isBuffer(value) || isTypedArray(value) || isArguments(value))) {
            return !value.length;
          }
          var tag = getTag(value);
          if (tag == mapTag || tag == setTag) {
            return !value.size;
          }
          if (isPrototype(value)) {
            return !baseKeys(value).length;
          }
          for (var key in value) {
            if (hasOwnProperty.call(value, key)) {
              return false;
            }
          }
          return true;
        }

        /**
         * Performs a deep comparison between two values to determine if they are
         * equivalent.
         *
         * **Note:** This method supports comparing arrays, array buffers, booleans,
         * date objects, error objects, maps, numbers, `Object` objects, regexes,
         * sets, strings, symbols, and typed arrays. `Object` objects are compared
         * by their own, not inherited, enumerable properties. Functions and DOM
         * nodes are compared by strict equality, i.e. `===`.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Lang
         * @param {*} value The value to compare.
         * @param {*} other The other value to compare.
         * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
         * @example
         *
         * var object = { 'a': 1 };
         * var other = { 'a': 1 };
         *
         * _.isEqual(object, other);
         * // => true
         *
         * object === other;
         * // => false
         */
        function isEqual(value, other) {
          return baseIsEqual(value, other);
        }

        /**
         * This method is like `_.isEqual` except that it accepts `customizer` which
         * is invoked to compare values. If `customizer` returns `undefined`, comparisons
         * are handled by the method instead. The `customizer` is invoked with up to
         * six arguments: (objValue, othValue [, index|key, object, other, stack]).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to compare.
         * @param {*} other The other value to compare.
         * @param {Function} [customizer] The function to customize comparisons.
         * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
         * @example
         *
         * function isGreeting(value) {
         *   return /^h(?:i|ello)$/.test(value);
         * }
         *
         * function customizer(objValue, othValue) {
         *   if (isGreeting(objValue) && isGreeting(othValue)) {
         *     return true;
         *   }
         * }
         *
         * var array = ['hello', 'goodbye'];
         * var other = ['hi', 'goodbye'];
         *
         * _.isEqualWith(array, other, customizer);
         * // => true
         */
        function isEqualWith(value, other, customizer) {
          customizer = typeof customizer == 'function' ? customizer : undefined$1;
          var result = customizer ? customizer(value, other) : undefined$1;
          return result === undefined$1 ? baseIsEqual(value, other, undefined$1, customizer) : !!result;
        }

        /**
         * Checks if `value` is an `Error`, `EvalError`, `RangeError`, `ReferenceError`,
         * `SyntaxError`, `TypeError`, or `URIError` object.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is an error object, else `false`.
         * @example
         *
         * _.isError(new Error);
         * // => true
         *
         * _.isError(Error);
         * // => false
         */
        function isError(value) {
          if (!isObjectLike(value)) {
            return false;
          }
          var tag = baseGetTag(value);
          return tag == errorTag || tag == domExcTag ||
            (typeof value.message == 'string' && typeof value.name == 'string' && !isPlainObject(value));
        }

        /**
         * Checks if `value` is a finite primitive number.
         *
         * **Note:** This method is based on
         * [`Number.isFinite`](https://mdn.io/Number/isFinite).
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a finite number, else `false`.
         * @example
         *
         * _.isFinite(3);
         * // => true
         *
         * _.isFinite(Number.MIN_VALUE);
         * // => true
         *
         * _.isFinite(Infinity);
         * // => false
         *
         * _.isFinite('3');
         * // => false
         */
        function isFinite(value) {
          return typeof value == 'number' && nativeIsFinite(value);
        }

        /**
         * Checks if `value` is classified as a `Function` object.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a function, else `false`.
         * @example
         *
         * _.isFunction(_);
         * // => true
         *
         * _.isFunction(/abc/);
         * // => false
         */
        function isFunction(value) {
          if (!isObject(value)) {
            return false;
          }
          // The use of `Object#toString` avoids issues with the `typeof` operator
          // in Safari 9 which returns 'object' for typed arrays and other constructors.
          var tag = baseGetTag(value);
          return tag == funcTag || tag == genTag || tag == asyncTag || tag == proxyTag;
        }

        /**
         * Checks if `value` is an integer.
         *
         * **Note:** This method is based on
         * [`Number.isInteger`](https://mdn.io/Number/isInteger).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is an integer, else `false`.
         * @example
         *
         * _.isInteger(3);
         * // => true
         *
         * _.isInteger(Number.MIN_VALUE);
         * // => false
         *
         * _.isInteger(Infinity);
         * // => false
         *
         * _.isInteger('3');
         * // => false
         */
        function isInteger(value) {
          return typeof value == 'number' && value == toInteger(value);
        }

        /**
         * Checks if `value` is a valid array-like length.
         *
         * **Note:** This method is loosely based on
         * [`ToLength`](http://ecma-international.org/ecma-262/7.0/#sec-tolength).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a valid length, else `false`.
         * @example
         *
         * _.isLength(3);
         * // => true
         *
         * _.isLength(Number.MIN_VALUE);
         * // => false
         *
         * _.isLength(Infinity);
         * // => false
         *
         * _.isLength('3');
         * // => false
         */
        function isLength(value) {
          return typeof value == 'number' &&
            value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
        }

        /**
         * Checks if `value` is the
         * [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
         * of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is an object, else `false`.
         * @example
         *
         * _.isObject({});
         * // => true
         *
         * _.isObject([1, 2, 3]);
         * // => true
         *
         * _.isObject(_.noop);
         * // => true
         *
         * _.isObject(null);
         * // => false
         */
        function isObject(value) {
          var type = typeof value;
          return value != null && (type == 'object' || type == 'function');
        }

        /**
         * Checks if `value` is object-like. A value is object-like if it's not `null`
         * and has a `typeof` result of "object".
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
         * @example
         *
         * _.isObjectLike({});
         * // => true
         *
         * _.isObjectLike([1, 2, 3]);
         * // => true
         *
         * _.isObjectLike(_.noop);
         * // => false
         *
         * _.isObjectLike(null);
         * // => false
         */
        function isObjectLike(value) {
          return value != null && typeof value == 'object';
        }

        /**
         * Checks if `value` is classified as a `Map` object.
         *
         * @static
         * @memberOf _
         * @since 4.3.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a map, else `false`.
         * @example
         *
         * _.isMap(new Map);
         * // => true
         *
         * _.isMap(new WeakMap);
         * // => false
         */
        var isMap = nodeIsMap ? baseUnary(nodeIsMap) : baseIsMap;

        /**
         * Performs a partial deep comparison between `object` and `source` to
         * determine if `object` contains equivalent property values.
         *
         * **Note:** This method is equivalent to `_.matches` when `source` is
         * partially applied.
         *
         * Partial comparisons will match empty array and empty object `source`
         * values against any array or object value, respectively. See `_.isEqual`
         * for a list of supported value comparisons.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Lang
         * @param {Object} object The object to inspect.
         * @param {Object} source The object of property values to match.
         * @returns {boolean} Returns `true` if `object` is a match, else `false`.
         * @example
         *
         * var object = { 'a': 1, 'b': 2 };
         *
         * _.isMatch(object, { 'b': 2 });
         * // => true
         *
         * _.isMatch(object, { 'b': 1 });
         * // => false
         */
        function isMatch(object, source) {
          return object === source || baseIsMatch(object, source, getMatchData(source));
        }

        /**
         * This method is like `_.isMatch` except that it accepts `customizer` which
         * is invoked to compare values. If `customizer` returns `undefined`, comparisons
         * are handled by the method instead. The `customizer` is invoked with five
         * arguments: (objValue, srcValue, index|key, object, source).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {Object} object The object to inspect.
         * @param {Object} source The object of property values to match.
         * @param {Function} [customizer] The function to customize comparisons.
         * @returns {boolean} Returns `true` if `object` is a match, else `false`.
         * @example
         *
         * function isGreeting(value) {
         *   return /^h(?:i|ello)$/.test(value);
         * }
         *
         * function customizer(objValue, srcValue) {
         *   if (isGreeting(objValue) && isGreeting(srcValue)) {
         *     return true;
         *   }
         * }
         *
         * var object = { 'greeting': 'hello' };
         * var source = { 'greeting': 'hi' };
         *
         * _.isMatchWith(object, source, customizer);
         * // => true
         */
        function isMatchWith(object, source, customizer) {
          customizer = typeof customizer == 'function' ? customizer : undefined$1;
          return baseIsMatch(object, source, getMatchData(source), customizer);
        }

        /**
         * Checks if `value` is `NaN`.
         *
         * **Note:** This method is based on
         * [`Number.isNaN`](https://mdn.io/Number/isNaN) and is not the same as
         * global [`isNaN`](https://mdn.io/isNaN) which returns `true` for
         * `undefined` and other non-number values.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is `NaN`, else `false`.
         * @example
         *
         * _.isNaN(NaN);
         * // => true
         *
         * _.isNaN(new Number(NaN));
         * // => true
         *
         * isNaN(undefined);
         * // => true
         *
         * _.isNaN(undefined);
         * // => false
         */
        function isNaN(value) {
          // An `NaN` primitive is the only value that is not equal to itself.
          // Perform the `toStringTag` check first to avoid errors with some
          // ActiveX objects in IE.
          return isNumber(value) && value != +value;
        }

        /**
         * Checks if `value` is a pristine native function.
         *
         * **Note:** This method can't reliably detect native functions in the presence
         * of the core-js package because core-js circumvents this kind of detection.
         * Despite multiple requests, the core-js maintainer has made it clear: any
         * attempt to fix the detection will be obstructed. As a result, we're left
         * with little choice but to throw an error. Unfortunately, this also affects
         * packages, like [babel-polyfill](https://www.npmjs.com/package/babel-polyfill),
         * which rely on core-js.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a native function,
         *  else `false`.
         * @example
         *
         * _.isNative(Array.prototype.push);
         * // => true
         *
         * _.isNative(_);
         * // => false
         */
        function isNative(value) {
          if (isMaskable(value)) {
            throw new Error(CORE_ERROR_TEXT);
          }
          return baseIsNative(value);
        }

        /**
         * Checks if `value` is `null`.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is `null`, else `false`.
         * @example
         *
         * _.isNull(null);
         * // => true
         *
         * _.isNull(void 0);
         * // => false
         */
        function isNull(value) {
          return value === null;
        }

        /**
         * Checks if `value` is `null` or `undefined`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is nullish, else `false`.
         * @example
         *
         * _.isNil(null);
         * // => true
         *
         * _.isNil(void 0);
         * // => true
         *
         * _.isNil(NaN);
         * // => false
         */
        function isNil(value) {
          return value == null;
        }

        /**
         * Checks if `value` is classified as a `Number` primitive or object.
         *
         * **Note:** To exclude `Infinity`, `-Infinity`, and `NaN`, which are
         * classified as numbers, use the `_.isFinite` method.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a number, else `false`.
         * @example
         *
         * _.isNumber(3);
         * // => true
         *
         * _.isNumber(Number.MIN_VALUE);
         * // => true
         *
         * _.isNumber(Infinity);
         * // => true
         *
         * _.isNumber('3');
         * // => false
         */
        function isNumber(value) {
          return typeof value == 'number' ||
            (isObjectLike(value) && baseGetTag(value) == numberTag);
        }

        /**
         * Checks if `value` is a plain object, that is, an object created by the
         * `Object` constructor or one with a `[[Prototype]]` of `null`.
         *
         * @static
         * @memberOf _
         * @since 0.8.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a plain object, else `false`.
         * @example
         *
         * function Foo() {
         *   this.a = 1;
         * }
         *
         * _.isPlainObject(new Foo);
         * // => false
         *
         * _.isPlainObject([1, 2, 3]);
         * // => false
         *
         * _.isPlainObject({ 'x': 0, 'y': 0 });
         * // => true
         *
         * _.isPlainObject(Object.create(null));
         * // => true
         */
        function isPlainObject(value) {
          if (!isObjectLike(value) || baseGetTag(value) != objectTag) {
            return false;
          }
          var proto = getPrototype(value);
          if (proto === null) {
            return true;
          }
          var Ctor = hasOwnProperty.call(proto, 'constructor') && proto.constructor;
          return typeof Ctor == 'function' && Ctor instanceof Ctor &&
            funcToString.call(Ctor) == objectCtorString;
        }

        /**
         * Checks if `value` is classified as a `RegExp` object.
         *
         * @static
         * @memberOf _
         * @since 0.1.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a regexp, else `false`.
         * @example
         *
         * _.isRegExp(/abc/);
         * // => true
         *
         * _.isRegExp('/abc/');
         * // => false
         */
        var isRegExp = nodeIsRegExp ? baseUnary(nodeIsRegExp) : baseIsRegExp;

        /**
         * Checks if `value` is a safe integer. An integer is safe if it's an IEEE-754
         * double precision number which isn't the result of a rounded unsafe integer.
         *
         * **Note:** This method is based on
         * [`Number.isSafeInteger`](https://mdn.io/Number/isSafeInteger).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a safe integer, else `false`.
         * @example
         *
         * _.isSafeInteger(3);
         * // => true
         *
         * _.isSafeInteger(Number.MIN_VALUE);
         * // => false
         *
         * _.isSafeInteger(Infinity);
         * // => false
         *
         * _.isSafeInteger('3');
         * // => false
         */
        function isSafeInteger(value) {
          return isInteger(value) && value >= -MAX_SAFE_INTEGER && value <= MAX_SAFE_INTEGER;
        }

        /**
         * Checks if `value` is classified as a `Set` object.
         *
         * @static
         * @memberOf _
         * @since 4.3.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a set, else `false`.
         * @example
         *
         * _.isSet(new Set);
         * // => true
         *
         * _.isSet(new WeakSet);
         * // => false
         */
        var isSet = nodeIsSet ? baseUnary(nodeIsSet) : baseIsSet;

        /**
         * Checks if `value` is classified as a `String` primitive or object.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a string, else `false`.
         * @example
         *
         * _.isString('abc');
         * // => true
         *
         * _.isString(1);
         * // => false
         */
        function isString(value) {
          return typeof value == 'string' ||
            (!isArray(value) && isObjectLike(value) && baseGetTag(value) == stringTag);
        }

        /**
         * Checks if `value` is classified as a `Symbol` primitive or object.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a symbol, else `false`.
         * @example
         *
         * _.isSymbol(Symbol.iterator);
         * // => true
         *
         * _.isSymbol('abc');
         * // => false
         */
        function isSymbol(value) {
          return typeof value == 'symbol' ||
            (isObjectLike(value) && baseGetTag(value) == symbolTag);
        }

        /**
         * Checks if `value` is classified as a typed array.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
         * @example
         *
         * _.isTypedArray(new Uint8Array);
         * // => true
         *
         * _.isTypedArray([]);
         * // => false
         */
        var isTypedArray = nodeIsTypedArray ? baseUnary(nodeIsTypedArray) : baseIsTypedArray;

        /**
         * Checks if `value` is `undefined`.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is `undefined`, else `false`.
         * @example
         *
         * _.isUndefined(void 0);
         * // => true
         *
         * _.isUndefined(null);
         * // => false
         */
        function isUndefined(value) {
          return value === undefined$1;
        }

        /**
         * Checks if `value` is classified as a `WeakMap` object.
         *
         * @static
         * @memberOf _
         * @since 4.3.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a weak map, else `false`.
         * @example
         *
         * _.isWeakMap(new WeakMap);
         * // => true
         *
         * _.isWeakMap(new Map);
         * // => false
         */
        function isWeakMap(value) {
          return isObjectLike(value) && getTag(value) == weakMapTag;
        }

        /**
         * Checks if `value` is classified as a `WeakSet` object.
         *
         * @static
         * @memberOf _
         * @since 4.3.0
         * @category Lang
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a weak set, else `false`.
         * @example
         *
         * _.isWeakSet(new WeakSet);
         * // => true
         *
         * _.isWeakSet(new Set);
         * // => false
         */
        function isWeakSet(value) {
          return isObjectLike(value) && baseGetTag(value) == weakSetTag;
        }

        /**
         * Checks if `value` is less than `other`.
         *
         * @static
         * @memberOf _
         * @since 3.9.0
         * @category Lang
         * @param {*} value The value to compare.
         * @param {*} other The other value to compare.
         * @returns {boolean} Returns `true` if `value` is less than `other`,
         *  else `false`.
         * @see _.gt
         * @example
         *
         * _.lt(1, 3);
         * // => true
         *
         * _.lt(3, 3);
         * // => false
         *
         * _.lt(3, 1);
         * // => false
         */
        var lt = createRelationalOperation(baseLt);

        /**
         * Checks if `value` is less than or equal to `other`.
         *
         * @static
         * @memberOf _
         * @since 3.9.0
         * @category Lang
         * @param {*} value The value to compare.
         * @param {*} other The other value to compare.
         * @returns {boolean} Returns `true` if `value` is less than or equal to
         *  `other`, else `false`.
         * @see _.gte
         * @example
         *
         * _.lte(1, 3);
         * // => true
         *
         * _.lte(3, 3);
         * // => true
         *
         * _.lte(3, 1);
         * // => false
         */
        var lte = createRelationalOperation(function(value, other) {
          return value <= other;
        });

        /**
         * Converts `value` to an array.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Lang
         * @param {*} value The value to convert.
         * @returns {Array} Returns the converted array.
         * @example
         *
         * _.toArray({ 'a': 1, 'b': 2 });
         * // => [1, 2]
         *
         * _.toArray('abc');
         * // => ['a', 'b', 'c']
         *
         * _.toArray(1);
         * // => []
         *
         * _.toArray(null);
         * // => []
         */
        function toArray(value) {
          if (!value) {
            return [];
          }
          if (isArrayLike(value)) {
            return isString(value) ? stringToArray(value) : copyArray(value);
          }
          if (symIterator && value[symIterator]) {
            return iteratorToArray(value[symIterator]());
          }
          var tag = getTag(value),
              func = tag == mapTag ? mapToArray : (tag == setTag ? setToArray : values);

          return func(value);
        }

        /**
         * Converts `value` to a finite number.
         *
         * @static
         * @memberOf _
         * @since 4.12.0
         * @category Lang
         * @param {*} value The value to convert.
         * @returns {number} Returns the converted number.
         * @example
         *
         * _.toFinite(3.2);
         * // => 3.2
         *
         * _.toFinite(Number.MIN_VALUE);
         * // => 5e-324
         *
         * _.toFinite(Infinity);
         * // => 1.7976931348623157e+308
         *
         * _.toFinite('3.2');
         * // => 3.2
         */
        function toFinite(value) {
          if (!value) {
            return value === 0 ? value : 0;
          }
          value = toNumber(value);
          if (value === INFINITY || value === -INFINITY) {
            var sign = (value < 0 ? -1 : 1);
            return sign * MAX_INTEGER;
          }
          return value === value ? value : 0;
        }

        /**
         * Converts `value` to an integer.
         *
         * **Note:** This method is loosely based on
         * [`ToInteger`](http://www.ecma-international.org/ecma-262/7.0/#sec-tointeger).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to convert.
         * @returns {number} Returns the converted integer.
         * @example
         *
         * _.toInteger(3.2);
         * // => 3
         *
         * _.toInteger(Number.MIN_VALUE);
         * // => 0
         *
         * _.toInteger(Infinity);
         * // => 1.7976931348623157e+308
         *
         * _.toInteger('3.2');
         * // => 3
         */
        function toInteger(value) {
          var result = toFinite(value),
              remainder = result % 1;

          return result === result ? (remainder ? result - remainder : result) : 0;
        }

        /**
         * Converts `value` to an integer suitable for use as the length of an
         * array-like object.
         *
         * **Note:** This method is based on
         * [`ToLength`](http://ecma-international.org/ecma-262/7.0/#sec-tolength).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to convert.
         * @returns {number} Returns the converted integer.
         * @example
         *
         * _.toLength(3.2);
         * // => 3
         *
         * _.toLength(Number.MIN_VALUE);
         * // => 0
         *
         * _.toLength(Infinity);
         * // => 4294967295
         *
         * _.toLength('3.2');
         * // => 3
         */
        function toLength(value) {
          return value ? baseClamp(toInteger(value), 0, MAX_ARRAY_LENGTH) : 0;
        }

        /**
         * Converts `value` to a number.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to process.
         * @returns {number} Returns the number.
         * @example
         *
         * _.toNumber(3.2);
         * // => 3.2
         *
         * _.toNumber(Number.MIN_VALUE);
         * // => 5e-324
         *
         * _.toNumber(Infinity);
         * // => Infinity
         *
         * _.toNumber('3.2');
         * // => 3.2
         */
        function toNumber(value) {
          if (typeof value == 'number') {
            return value;
          }
          if (isSymbol(value)) {
            return NAN;
          }
          if (isObject(value)) {
            var other = typeof value.valueOf == 'function' ? value.valueOf() : value;
            value = isObject(other) ? (other + '') : other;
          }
          if (typeof value != 'string') {
            return value === 0 ? value : +value;
          }
          value = baseTrim(value);
          var isBinary = reIsBinary.test(value);
          return (isBinary || reIsOctal.test(value))
            ? freeParseInt(value.slice(2), isBinary ? 2 : 8)
            : (reIsBadHex.test(value) ? NAN : +value);
        }

        /**
         * Converts `value` to a plain object flattening inherited enumerable string
         * keyed properties of `value` to own properties of the plain object.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Lang
         * @param {*} value The value to convert.
         * @returns {Object} Returns the converted plain object.
         * @example
         *
         * function Foo() {
         *   this.b = 2;
         * }
         *
         * Foo.prototype.c = 3;
         *
         * _.assign({ 'a': 1 }, new Foo);
         * // => { 'a': 1, 'b': 2 }
         *
         * _.assign({ 'a': 1 }, _.toPlainObject(new Foo));
         * // => { 'a': 1, 'b': 2, 'c': 3 }
         */
        function toPlainObject(value) {
          return copyObject(value, keysIn(value));
        }

        /**
         * Converts `value` to a safe integer. A safe integer can be compared and
         * represented correctly.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to convert.
         * @returns {number} Returns the converted integer.
         * @example
         *
         * _.toSafeInteger(3.2);
         * // => 3
         *
         * _.toSafeInteger(Number.MIN_VALUE);
         * // => 0
         *
         * _.toSafeInteger(Infinity);
         * // => 9007199254740991
         *
         * _.toSafeInteger('3.2');
         * // => 3
         */
        function toSafeInteger(value) {
          return value
            ? baseClamp(toInteger(value), -MAX_SAFE_INTEGER, MAX_SAFE_INTEGER)
            : (value === 0 ? value : 0);
        }

        /**
         * Converts `value` to a string. An empty string is returned for `null`
         * and `undefined` values. The sign of `-0` is preserved.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Lang
         * @param {*} value The value to convert.
         * @returns {string} Returns the converted string.
         * @example
         *
         * _.toString(null);
         * // => ''
         *
         * _.toString(-0);
         * // => '-0'
         *
         * _.toString([1, 2, 3]);
         * // => '1,2,3'
         */
        function toString(value) {
          return value == null ? '' : baseToString(value);
        }

        /*------------------------------------------------------------------------*/

        /**
         * Assigns own enumerable string keyed properties of source objects to the
         * destination object. Source objects are applied from left to right.
         * Subsequent sources overwrite property assignments of previous sources.
         *
         * **Note:** This method mutates `object` and is loosely based on
         * [`Object.assign`](https://mdn.io/Object/assign).
         *
         * @static
         * @memberOf _
         * @since 0.10.0
         * @category Object
         * @param {Object} object The destination object.
         * @param {...Object} [sources] The source objects.
         * @returns {Object} Returns `object`.
         * @see _.assignIn
         * @example
         *
         * function Foo() {
         *   this.a = 1;
         * }
         *
         * function Bar() {
         *   this.c = 3;
         * }
         *
         * Foo.prototype.b = 2;
         * Bar.prototype.d = 4;
         *
         * _.assign({ 'a': 0 }, new Foo, new Bar);
         * // => { 'a': 1, 'c': 3 }
         */
        var assign = createAssigner(function(object, source) {
          if (isPrototype(source) || isArrayLike(source)) {
            copyObject(source, keys(source), object);
            return;
          }
          for (var key in source) {
            if (hasOwnProperty.call(source, key)) {
              assignValue(object, key, source[key]);
            }
          }
        });

        /**
         * This method is like `_.assign` except that it iterates over own and
         * inherited source properties.
         *
         * **Note:** This method mutates `object`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @alias extend
         * @category Object
         * @param {Object} object The destination object.
         * @param {...Object} [sources] The source objects.
         * @returns {Object} Returns `object`.
         * @see _.assign
         * @example
         *
         * function Foo() {
         *   this.a = 1;
         * }
         *
         * function Bar() {
         *   this.c = 3;
         * }
         *
         * Foo.prototype.b = 2;
         * Bar.prototype.d = 4;
         *
         * _.assignIn({ 'a': 0 }, new Foo, new Bar);
         * // => { 'a': 1, 'b': 2, 'c': 3, 'd': 4 }
         */
        var assignIn = createAssigner(function(object, source) {
          copyObject(source, keysIn(source), object);
        });

        /**
         * This method is like `_.assignIn` except that it accepts `customizer`
         * which is invoked to produce the assigned values. If `customizer` returns
         * `undefined`, assignment is handled by the method instead. The `customizer`
         * is invoked with five arguments: (objValue, srcValue, key, object, source).
         *
         * **Note:** This method mutates `object`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @alias extendWith
         * @category Object
         * @param {Object} object The destination object.
         * @param {...Object} sources The source objects.
         * @param {Function} [customizer] The function to customize assigned values.
         * @returns {Object} Returns `object`.
         * @see _.assignWith
         * @example
         *
         * function customizer(objValue, srcValue) {
         *   return _.isUndefined(objValue) ? srcValue : objValue;
         * }
         *
         * var defaults = _.partialRight(_.assignInWith, customizer);
         *
         * defaults({ 'a': 1 }, { 'b': 2 }, { 'a': 3 });
         * // => { 'a': 1, 'b': 2 }
         */
        var assignInWith = createAssigner(function(object, source, srcIndex, customizer) {
          copyObject(source, keysIn(source), object, customizer);
        });

        /**
         * This method is like `_.assign` except that it accepts `customizer`
         * which is invoked to produce the assigned values. If `customizer` returns
         * `undefined`, assignment is handled by the method instead. The `customizer`
         * is invoked with five arguments: (objValue, srcValue, key, object, source).
         *
         * **Note:** This method mutates `object`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Object
         * @param {Object} object The destination object.
         * @param {...Object} sources The source objects.
         * @param {Function} [customizer] The function to customize assigned values.
         * @returns {Object} Returns `object`.
         * @see _.assignInWith
         * @example
         *
         * function customizer(objValue, srcValue) {
         *   return _.isUndefined(objValue) ? srcValue : objValue;
         * }
         *
         * var defaults = _.partialRight(_.assignWith, customizer);
         *
         * defaults({ 'a': 1 }, { 'b': 2 }, { 'a': 3 });
         * // => { 'a': 1, 'b': 2 }
         */
        var assignWith = createAssigner(function(object, source, srcIndex, customizer) {
          copyObject(source, keys(source), object, customizer);
        });

        /**
         * Creates an array of values corresponding to `paths` of `object`.
         *
         * @static
         * @memberOf _
         * @since 1.0.0
         * @category Object
         * @param {Object} object The object to iterate over.
         * @param {...(string|string[])} [paths] The property paths to pick.
         * @returns {Array} Returns the picked values.
         * @example
         *
         * var object = { 'a': [{ 'b': { 'c': 3 } }, 4] };
         *
         * _.at(object, ['a[0].b.c', 'a[1]']);
         * // => [3, 4]
         */
        var at = flatRest(baseAt);

        /**
         * Creates an object that inherits from the `prototype` object. If a
         * `properties` object is given, its own enumerable string keyed properties
         * are assigned to the created object.
         *
         * @static
         * @memberOf _
         * @since 2.3.0
         * @category Object
         * @param {Object} prototype The object to inherit from.
         * @param {Object} [properties] The properties to assign to the object.
         * @returns {Object} Returns the new object.
         * @example
         *
         * function Shape() {
         *   this.x = 0;
         *   this.y = 0;
         * }
         *
         * function Circle() {
         *   Shape.call(this);
         * }
         *
         * Circle.prototype = _.create(Shape.prototype, {
         *   'constructor': Circle
         * });
         *
         * var circle = new Circle;
         * circle instanceof Circle;
         * // => true
         *
         * circle instanceof Shape;
         * // => true
         */
        function create(prototype, properties) {
          var result = baseCreate(prototype);
          return properties == null ? result : baseAssign(result, properties);
        }

        /**
         * Assigns own and inherited enumerable string keyed properties of source
         * objects to the destination object for all destination properties that
         * resolve to `undefined`. Source objects are applied from left to right.
         * Once a property is set, additional values of the same property are ignored.
         *
         * **Note:** This method mutates `object`.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Object
         * @param {Object} object The destination object.
         * @param {...Object} [sources] The source objects.
         * @returns {Object} Returns `object`.
         * @see _.defaultsDeep
         * @example
         *
         * _.defaults({ 'a': 1 }, { 'b': 2 }, { 'a': 3 });
         * // => { 'a': 1, 'b': 2 }
         */
        var defaults = baseRest(function(object, sources) {
          object = Object(object);

          var index = -1;
          var length = sources.length;
          var guard = length > 2 ? sources[2] : undefined$1;

          if (guard && isIterateeCall(sources[0], sources[1], guard)) {
            length = 1;
          }

          while (++index < length) {
            var source = sources[index];
            var props = keysIn(source);
            var propsIndex = -1;
            var propsLength = props.length;

            while (++propsIndex < propsLength) {
              var key = props[propsIndex];
              var value = object[key];

              if (value === undefined$1 ||
                  (eq(value, objectProto[key]) && !hasOwnProperty.call(object, key))) {
                object[key] = source[key];
              }
            }
          }

          return object;
        });

        /**
         * This method is like `_.defaults` except that it recursively assigns
         * default properties.
         *
         * **Note:** This method mutates `object`.
         *
         * @static
         * @memberOf _
         * @since 3.10.0
         * @category Object
         * @param {Object} object The destination object.
         * @param {...Object} [sources] The source objects.
         * @returns {Object} Returns `object`.
         * @see _.defaults
         * @example
         *
         * _.defaultsDeep({ 'a': { 'b': 2 } }, { 'a': { 'b': 1, 'c': 3 } });
         * // => { 'a': { 'b': 2, 'c': 3 } }
         */
        var defaultsDeep = baseRest(function(args) {
          args.push(undefined$1, customDefaultsMerge);
          return apply(mergeWith, undefined$1, args);
        });

        /**
         * This method is like `_.find` except that it returns the key of the first
         * element `predicate` returns truthy for instead of the element itself.
         *
         * @static
         * @memberOf _
         * @since 1.1.0
         * @category Object
         * @param {Object} object The object to inspect.
         * @param {Function} [predicate=_.identity] The function invoked per iteration.
         * @returns {string|undefined} Returns the key of the matched element,
         *  else `undefined`.
         * @example
         *
         * var users = {
         *   'barney':  { 'age': 36, 'active': true },
         *   'fred':    { 'age': 40, 'active': false },
         *   'pebbles': { 'age': 1,  'active': true }
         * };
         *
         * _.findKey(users, function(o) { return o.age < 40; });
         * // => 'barney' (iteration order is not guaranteed)
         *
         * // The `_.matches` iteratee shorthand.
         * _.findKey(users, { 'age': 1, 'active': true });
         * // => 'pebbles'
         *
         * // The `_.matchesProperty` iteratee shorthand.
         * _.findKey(users, ['active', false]);
         * // => 'fred'
         *
         * // The `_.property` iteratee shorthand.
         * _.findKey(users, 'active');
         * // => 'barney'
         */
        function findKey(object, predicate) {
          return baseFindKey(object, getIteratee(predicate, 3), baseForOwn);
        }

        /**
         * This method is like `_.findKey` except that it iterates over elements of
         * a collection in the opposite order.
         *
         * @static
         * @memberOf _
         * @since 2.0.0
         * @category Object
         * @param {Object} object The object to inspect.
         * @param {Function} [predicate=_.identity] The function invoked per iteration.
         * @returns {string|undefined} Returns the key of the matched element,
         *  else `undefined`.
         * @example
         *
         * var users = {
         *   'barney':  { 'age': 36, 'active': true },
         *   'fred':    { 'age': 40, 'active': false },
         *   'pebbles': { 'age': 1,  'active': true }
         * };
         *
         * _.findLastKey(users, function(o) { return o.age < 40; });
         * // => returns 'pebbles' assuming `_.findKey` returns 'barney'
         *
         * // The `_.matches` iteratee shorthand.
         * _.findLastKey(users, { 'age': 36, 'active': true });
         * // => 'barney'
         *
         * // The `_.matchesProperty` iteratee shorthand.
         * _.findLastKey(users, ['active', false]);
         * // => 'fred'
         *
         * // The `_.property` iteratee shorthand.
         * _.findLastKey(users, 'active');
         * // => 'pebbles'
         */
        function findLastKey(object, predicate) {
          return baseFindKey(object, getIteratee(predicate, 3), baseForOwnRight);
        }

        /**
         * Iterates over own and inherited enumerable string keyed properties of an
         * object and invokes `iteratee` for each property. The iteratee is invoked
         * with three arguments: (value, key, object). Iteratee functions may exit
         * iteration early by explicitly returning `false`.
         *
         * @static
         * @memberOf _
         * @since 0.3.0
         * @category Object
         * @param {Object} object The object to iterate over.
         * @param {Function} [iteratee=_.identity] The function invoked per iteration.
         * @returns {Object} Returns `object`.
         * @see _.forInRight
         * @example
         *
         * function Foo() {
         *   this.a = 1;
         *   this.b = 2;
         * }
         *
         * Foo.prototype.c = 3;
         *
         * _.forIn(new Foo, function(value, key) {
         *   console.log(key);
         * });
         * // => Logs 'a', 'b', then 'c' (iteration order is not guaranteed).
         */
        function forIn(object, iteratee) {
          return object == null
            ? object
            : baseFor(object, getIteratee(iteratee, 3), keysIn);
        }

        /**
         * This method is like `_.forIn` except that it iterates over properties of
         * `object` in the opposite order.
         *
         * @static
         * @memberOf _
         * @since 2.0.0
         * @category Object
         * @param {Object} object The object to iterate over.
         * @param {Function} [iteratee=_.identity] The function invoked per iteration.
         * @returns {Object} Returns `object`.
         * @see _.forIn
         * @example
         *
         * function Foo() {
         *   this.a = 1;
         *   this.b = 2;
         * }
         *
         * Foo.prototype.c = 3;
         *
         * _.forInRight(new Foo, function(value, key) {
         *   console.log(key);
         * });
         * // => Logs 'c', 'b', then 'a' assuming `_.forIn` logs 'a', 'b', then 'c'.
         */
        function forInRight(object, iteratee) {
          return object == null
            ? object
            : baseForRight(object, getIteratee(iteratee, 3), keysIn);
        }

        /**
         * Iterates over own enumerable string keyed properties of an object and
         * invokes `iteratee` for each property. The iteratee is invoked with three
         * arguments: (value, key, object). Iteratee functions may exit iteration
         * early by explicitly returning `false`.
         *
         * @static
         * @memberOf _
         * @since 0.3.0
         * @category Object
         * @param {Object} object The object to iterate over.
         * @param {Function} [iteratee=_.identity] The function invoked per iteration.
         * @returns {Object} Returns `object`.
         * @see _.forOwnRight
         * @example
         *
         * function Foo() {
         *   this.a = 1;
         *   this.b = 2;
         * }
         *
         * Foo.prototype.c = 3;
         *
         * _.forOwn(new Foo, function(value, key) {
         *   console.log(key);
         * });
         * // => Logs 'a' then 'b' (iteration order is not guaranteed).
         */
        function forOwn(object, iteratee) {
          return object && baseForOwn(object, getIteratee(iteratee, 3));
        }

        /**
         * This method is like `_.forOwn` except that it iterates over properties of
         * `object` in the opposite order.
         *
         * @static
         * @memberOf _
         * @since 2.0.0
         * @category Object
         * @param {Object} object The object to iterate over.
         * @param {Function} [iteratee=_.identity] The function invoked per iteration.
         * @returns {Object} Returns `object`.
         * @see _.forOwn
         * @example
         *
         * function Foo() {
         *   this.a = 1;
         *   this.b = 2;
         * }
         *
         * Foo.prototype.c = 3;
         *
         * _.forOwnRight(new Foo, function(value, key) {
         *   console.log(key);
         * });
         * // => Logs 'b' then 'a' assuming `_.forOwn` logs 'a' then 'b'.
         */
        function forOwnRight(object, iteratee) {
          return object && baseForOwnRight(object, getIteratee(iteratee, 3));
        }

        /**
         * Creates an array of function property names from own enumerable properties
         * of `object`.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Object
         * @param {Object} object The object to inspect.
         * @returns {Array} Returns the function names.
         * @see _.functionsIn
         * @example
         *
         * function Foo() {
         *   this.a = _.constant('a');
         *   this.b = _.constant('b');
         * }
         *
         * Foo.prototype.c = _.constant('c');
         *
         * _.functions(new Foo);
         * // => ['a', 'b']
         */
        function functions(object) {
          return object == null ? [] : baseFunctions(object, keys(object));
        }

        /**
         * Creates an array of function property names from own and inherited
         * enumerable properties of `object`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Object
         * @param {Object} object The object to inspect.
         * @returns {Array} Returns the function names.
         * @see _.functions
         * @example
         *
         * function Foo() {
         *   this.a = _.constant('a');
         *   this.b = _.constant('b');
         * }
         *
         * Foo.prototype.c = _.constant('c');
         *
         * _.functionsIn(new Foo);
         * // => ['a', 'b', 'c']
         */
        function functionsIn(object) {
          return object == null ? [] : baseFunctions(object, keysIn(object));
        }

        /**
         * Gets the value at `path` of `object`. If the resolved value is
         * `undefined`, the `defaultValue` is returned in its place.
         *
         * @static
         * @memberOf _
         * @since 3.7.0
         * @category Object
         * @param {Object} object The object to query.
         * @param {Array|string} path The path of the property to get.
         * @param {*} [defaultValue] The value returned for `undefined` resolved values.
         * @returns {*} Returns the resolved value.
         * @example
         *
         * var object = { 'a': [{ 'b': { 'c': 3 } }] };
         *
         * _.get(object, 'a[0].b.c');
         * // => 3
         *
         * _.get(object, ['a', '0', 'b', 'c']);
         * // => 3
         *
         * _.get(object, 'a.b.c', 'default');
         * // => 'default'
         */
        function get(object, path, defaultValue) {
          var result = object == null ? undefined$1 : baseGet(object, path);
          return result === undefined$1 ? defaultValue : result;
        }

        /**
         * Checks if `path` is a direct property of `object`.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Object
         * @param {Object} object The object to query.
         * @param {Array|string} path The path to check.
         * @returns {boolean} Returns `true` if `path` exists, else `false`.
         * @example
         *
         * var object = { 'a': { 'b': 2 } };
         * var other = _.create({ 'a': _.create({ 'b': 2 }) });
         *
         * _.has(object, 'a');
         * // => true
         *
         * _.has(object, 'a.b');
         * // => true
         *
         * _.has(object, ['a', 'b']);
         * // => true
         *
         * _.has(other, 'a');
         * // => false
         */
        function has(object, path) {
          return object != null && hasPath(object, path, baseHas);
        }

        /**
         * Checks if `path` is a direct or inherited property of `object`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Object
         * @param {Object} object The object to query.
         * @param {Array|string} path The path to check.
         * @returns {boolean} Returns `true` if `path` exists, else `false`.
         * @example
         *
         * var object = _.create({ 'a': _.create({ 'b': 2 }) });
         *
         * _.hasIn(object, 'a');
         * // => true
         *
         * _.hasIn(object, 'a.b');
         * // => true
         *
         * _.hasIn(object, ['a', 'b']);
         * // => true
         *
         * _.hasIn(object, 'b');
         * // => false
         */
        function hasIn(object, path) {
          return object != null && hasPath(object, path, baseHasIn);
        }

        /**
         * Creates an object composed of the inverted keys and values of `object`.
         * If `object` contains duplicate values, subsequent values overwrite
         * property assignments of previous values.
         *
         * @static
         * @memberOf _
         * @since 0.7.0
         * @category Object
         * @param {Object} object The object to invert.
         * @returns {Object} Returns the new inverted object.
         * @example
         *
         * var object = { 'a': 1, 'b': 2, 'c': 1 };
         *
         * _.invert(object);
         * // => { '1': 'c', '2': 'b' }
         */
        var invert = createInverter(function(result, value, key) {
          if (value != null &&
              typeof value.toString != 'function') {
            value = nativeObjectToString.call(value);
          }

          result[value] = key;
        }, constant(identity));

        /**
         * This method is like `_.invert` except that the inverted object is generated
         * from the results of running each element of `object` thru `iteratee`. The
         * corresponding inverted value of each inverted key is an array of keys
         * responsible for generating the inverted value. The iteratee is invoked
         * with one argument: (value).
         *
         * @static
         * @memberOf _
         * @since 4.1.0
         * @category Object
         * @param {Object} object The object to invert.
         * @param {Function} [iteratee=_.identity] The iteratee invoked per element.
         * @returns {Object} Returns the new inverted object.
         * @example
         *
         * var object = { 'a': 1, 'b': 2, 'c': 1 };
         *
         * _.invertBy(object);
         * // => { '1': ['a', 'c'], '2': ['b'] }
         *
         * _.invertBy(object, function(value) {
         *   return 'group' + value;
         * });
         * // => { 'group1': ['a', 'c'], 'group2': ['b'] }
         */
        var invertBy = createInverter(function(result, value, key) {
          if (value != null &&
              typeof value.toString != 'function') {
            value = nativeObjectToString.call(value);
          }

          if (hasOwnProperty.call(result, value)) {
            result[value].push(key);
          } else {
            result[value] = [key];
          }
        }, getIteratee);

        /**
         * Invokes the method at `path` of `object`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Object
         * @param {Object} object The object to query.
         * @param {Array|string} path The path of the method to invoke.
         * @param {...*} [args] The arguments to invoke the method with.
         * @returns {*} Returns the result of the invoked method.
         * @example
         *
         * var object = { 'a': [{ 'b': { 'c': [1, 2, 3, 4] } }] };
         *
         * _.invoke(object, 'a[0].b.c.slice', 1, 3);
         * // => [2, 3]
         */
        var invoke = baseRest(baseInvoke);

        /**
         * Creates an array of the own enumerable property names of `object`.
         *
         * **Note:** Non-object values are coerced to objects. See the
         * [ES spec](http://ecma-international.org/ecma-262/7.0/#sec-object.keys)
         * for more details.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Object
         * @param {Object} object The object to query.
         * @returns {Array} Returns the array of property names.
         * @example
         *
         * function Foo() {
         *   this.a = 1;
         *   this.b = 2;
         * }
         *
         * Foo.prototype.c = 3;
         *
         * _.keys(new Foo);
         * // => ['a', 'b'] (iteration order is not guaranteed)
         *
         * _.keys('hi');
         * // => ['0', '1']
         */
        function keys(object) {
          return isArrayLike(object) ? arrayLikeKeys(object) : baseKeys(object);
        }

        /**
         * Creates an array of the own and inherited enumerable property names of `object`.
         *
         * **Note:** Non-object values are coerced to objects.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Object
         * @param {Object} object The object to query.
         * @returns {Array} Returns the array of property names.
         * @example
         *
         * function Foo() {
         *   this.a = 1;
         *   this.b = 2;
         * }
         *
         * Foo.prototype.c = 3;
         *
         * _.keysIn(new Foo);
         * // => ['a', 'b', 'c'] (iteration order is not guaranteed)
         */
        function keysIn(object) {
          return isArrayLike(object) ? arrayLikeKeys(object, true) : baseKeysIn(object);
        }

        /**
         * The opposite of `_.mapValues`; this method creates an object with the
         * same values as `object` and keys generated by running each own enumerable
         * string keyed property of `object` thru `iteratee`. The iteratee is invoked
         * with three arguments: (value, key, object).
         *
         * @static
         * @memberOf _
         * @since 3.8.0
         * @category Object
         * @param {Object} object The object to iterate over.
         * @param {Function} [iteratee=_.identity] The function invoked per iteration.
         * @returns {Object} Returns the new mapped object.
         * @see _.mapValues
         * @example
         *
         * _.mapKeys({ 'a': 1, 'b': 2 }, function(value, key) {
         *   return key + value;
         * });
         * // => { 'a1': 1, 'b2': 2 }
         */
        function mapKeys(object, iteratee) {
          var result = {};
          iteratee = getIteratee(iteratee, 3);

          baseForOwn(object, function(value, key, object) {
            baseAssignValue(result, iteratee(value, key, object), value);
          });
          return result;
        }

        /**
         * Creates an object with the same keys as `object` and values generated
         * by running each own enumerable string keyed property of `object` thru
         * `iteratee`. The iteratee is invoked with three arguments:
         * (value, key, object).
         *
         * @static
         * @memberOf _
         * @since 2.4.0
         * @category Object
         * @param {Object} object The object to iterate over.
         * @param {Function} [iteratee=_.identity] The function invoked per iteration.
         * @returns {Object} Returns the new mapped object.
         * @see _.mapKeys
         * @example
         *
         * var users = {
         *   'fred':    { 'user': 'fred',    'age': 40 },
         *   'pebbles': { 'user': 'pebbles', 'age': 1 }
         * };
         *
         * _.mapValues(users, function(o) { return o.age; });
         * // => { 'fred': 40, 'pebbles': 1 } (iteration order is not guaranteed)
         *
         * // The `_.property` iteratee shorthand.
         * _.mapValues(users, 'age');
         * // => { 'fred': 40, 'pebbles': 1 } (iteration order is not guaranteed)
         */
        function mapValues(object, iteratee) {
          var result = {};
          iteratee = getIteratee(iteratee, 3);

          baseForOwn(object, function(value, key, object) {
            baseAssignValue(result, key, iteratee(value, key, object));
          });
          return result;
        }

        /**
         * This method is like `_.assign` except that it recursively merges own and
         * inherited enumerable string keyed properties of source objects into the
         * destination object. Source properties that resolve to `undefined` are
         * skipped if a destination value exists. Array and plain object properties
         * are merged recursively. Other objects and value types are overridden by
         * assignment. Source objects are applied from left to right. Subsequent
         * sources overwrite property assignments of previous sources.
         *
         * **Note:** This method mutates `object`.
         *
         * @static
         * @memberOf _
         * @since 0.5.0
         * @category Object
         * @param {Object} object The destination object.
         * @param {...Object} [sources] The source objects.
         * @returns {Object} Returns `object`.
         * @example
         *
         * var object = {
         *   'a': [{ 'b': 2 }, { 'd': 4 }]
         * };
         *
         * var other = {
         *   'a': [{ 'c': 3 }, { 'e': 5 }]
         * };
         *
         * _.merge(object, other);
         * // => { 'a': [{ 'b': 2, 'c': 3 }, { 'd': 4, 'e': 5 }] }
         */
        var merge = createAssigner(function(object, source, srcIndex) {
          baseMerge(object, source, srcIndex);
        });

        /**
         * This method is like `_.merge` except that it accepts `customizer` which
         * is invoked to produce the merged values of the destination and source
         * properties. If `customizer` returns `undefined`, merging is handled by the
         * method instead. The `customizer` is invoked with six arguments:
         * (objValue, srcValue, key, object, source, stack).
         *
         * **Note:** This method mutates `object`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Object
         * @param {Object} object The destination object.
         * @param {...Object} sources The source objects.
         * @param {Function} customizer The function to customize assigned values.
         * @returns {Object} Returns `object`.
         * @example
         *
         * function customizer(objValue, srcValue) {
         *   if (_.isArray(objValue)) {
         *     return objValue.concat(srcValue);
         *   }
         * }
         *
         * var object = { 'a': [1], 'b': [2] };
         * var other = { 'a': [3], 'b': [4] };
         *
         * _.mergeWith(object, other, customizer);
         * // => { 'a': [1, 3], 'b': [2, 4] }
         */
        var mergeWith = createAssigner(function(object, source, srcIndex, customizer) {
          baseMerge(object, source, srcIndex, customizer);
        });

        /**
         * The opposite of `_.pick`; this method creates an object composed of the
         * own and inherited enumerable property paths of `object` that are not omitted.
         *
         * **Note:** This method is considerably slower than `_.pick`.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Object
         * @param {Object} object The source object.
         * @param {...(string|string[])} [paths] The property paths to omit.
         * @returns {Object} Returns the new object.
         * @example
         *
         * var object = { 'a': 1, 'b': '2', 'c': 3 };
         *
         * _.omit(object, ['a', 'c']);
         * // => { 'b': '2' }
         */
        var omit = flatRest(function(object, paths) {
          var result = {};
          if (object == null) {
            return result;
          }
          var isDeep = false;
          paths = arrayMap(paths, function(path) {
            path = castPath(path, object);
            isDeep || (isDeep = path.length > 1);
            return path;
          });
          copyObject(object, getAllKeysIn(object), result);
          if (isDeep) {
            result = baseClone(result, CLONE_DEEP_FLAG | CLONE_FLAT_FLAG | CLONE_SYMBOLS_FLAG, customOmitClone);
          }
          var length = paths.length;
          while (length--) {
            baseUnset(result, paths[length]);
          }
          return result;
        });

        /**
         * The opposite of `_.pickBy`; this method creates an object composed of
         * the own and inherited enumerable string keyed properties of `object` that
         * `predicate` doesn't return truthy for. The predicate is invoked with two
         * arguments: (value, key).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Object
         * @param {Object} object The source object.
         * @param {Function} [predicate=_.identity] The function invoked per property.
         * @returns {Object} Returns the new object.
         * @example
         *
         * var object = { 'a': 1, 'b': '2', 'c': 3 };
         *
         * _.omitBy(object, _.isNumber);
         * // => { 'b': '2' }
         */
        function omitBy(object, predicate) {
          return pickBy(object, negate(getIteratee(predicate)));
        }

        /**
         * Creates an object composed of the picked `object` properties.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Object
         * @param {Object} object The source object.
         * @param {...(string|string[])} [paths] The property paths to pick.
         * @returns {Object} Returns the new object.
         * @example
         *
         * var object = { 'a': 1, 'b': '2', 'c': 3 };
         *
         * _.pick(object, ['a', 'c']);
         * // => { 'a': 1, 'c': 3 }
         */
        var pick = flatRest(function(object, paths) {
          return object == null ? {} : basePick(object, paths);
        });

        /**
         * Creates an object composed of the `object` properties `predicate` returns
         * truthy for. The predicate is invoked with two arguments: (value, key).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Object
         * @param {Object} object The source object.
         * @param {Function} [predicate=_.identity] The function invoked per property.
         * @returns {Object} Returns the new object.
         * @example
         *
         * var object = { 'a': 1, 'b': '2', 'c': 3 };
         *
         * _.pickBy(object, _.isNumber);
         * // => { 'a': 1, 'c': 3 }
         */
        function pickBy(object, predicate) {
          if (object == null) {
            return {};
          }
          var props = arrayMap(getAllKeysIn(object), function(prop) {
            return [prop];
          });
          predicate = getIteratee(predicate);
          return basePickBy(object, props, function(value, path) {
            return predicate(value, path[0]);
          });
        }

        /**
         * This method is like `_.get` except that if the resolved value is a
         * function it's invoked with the `this` binding of its parent object and
         * its result is returned.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Object
         * @param {Object} object The object to query.
         * @param {Array|string} path The path of the property to resolve.
         * @param {*} [defaultValue] The value returned for `undefined` resolved values.
         * @returns {*} Returns the resolved value.
         * @example
         *
         * var object = { 'a': [{ 'b': { 'c1': 3, 'c2': _.constant(4) } }] };
         *
         * _.result(object, 'a[0].b.c1');
         * // => 3
         *
         * _.result(object, 'a[0].b.c2');
         * // => 4
         *
         * _.result(object, 'a[0].b.c3', 'default');
         * // => 'default'
         *
         * _.result(object, 'a[0].b.c3', _.constant('default'));
         * // => 'default'
         */
        function result(object, path, defaultValue) {
          path = castPath(path, object);

          var index = -1,
              length = path.length;

          // Ensure the loop is entered when path is empty.
          if (!length) {
            length = 1;
            object = undefined$1;
          }
          while (++index < length) {
            var value = object == null ? undefined$1 : object[toKey(path[index])];
            if (value === undefined$1) {
              index = length;
              value = defaultValue;
            }
            object = isFunction(value) ? value.call(object) : value;
          }
          return object;
        }

        /**
         * Sets the value at `path` of `object`. If a portion of `path` doesn't exist,
         * it's created. Arrays are created for missing index properties while objects
         * are created for all other missing properties. Use `_.setWith` to customize
         * `path` creation.
         *
         * **Note:** This method mutates `object`.
         *
         * @static
         * @memberOf _
         * @since 3.7.0
         * @category Object
         * @param {Object} object The object to modify.
         * @param {Array|string} path The path of the property to set.
         * @param {*} value The value to set.
         * @returns {Object} Returns `object`.
         * @example
         *
         * var object = { 'a': [{ 'b': { 'c': 3 } }] };
         *
         * _.set(object, 'a[0].b.c', 4);
         * console.log(object.a[0].b.c);
         * // => 4
         *
         * _.set(object, ['x', '0', 'y', 'z'], 5);
         * console.log(object.x[0].y.z);
         * // => 5
         */
        function set(object, path, value) {
          return object == null ? object : baseSet(object, path, value);
        }

        /**
         * This method is like `_.set` except that it accepts `customizer` which is
         * invoked to produce the objects of `path`.  If `customizer` returns `undefined`
         * path creation is handled by the method instead. The `customizer` is invoked
         * with three arguments: (nsValue, key, nsObject).
         *
         * **Note:** This method mutates `object`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Object
         * @param {Object} object The object to modify.
         * @param {Array|string} path The path of the property to set.
         * @param {*} value The value to set.
         * @param {Function} [customizer] The function to customize assigned values.
         * @returns {Object} Returns `object`.
         * @example
         *
         * var object = {};
         *
         * _.setWith(object, '[0][1]', 'a', Object);
         * // => { '0': { '1': 'a' } }
         */
        function setWith(object, path, value, customizer) {
          customizer = typeof customizer == 'function' ? customizer : undefined$1;
          return object == null ? object : baseSet(object, path, value, customizer);
        }

        /**
         * Creates an array of own enumerable string keyed-value pairs for `object`
         * which can be consumed by `_.fromPairs`. If `object` is a map or set, its
         * entries are returned.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @alias entries
         * @category Object
         * @param {Object} object The object to query.
         * @returns {Array} Returns the key-value pairs.
         * @example
         *
         * function Foo() {
         *   this.a = 1;
         *   this.b = 2;
         * }
         *
         * Foo.prototype.c = 3;
         *
         * _.toPairs(new Foo);
         * // => [['a', 1], ['b', 2]] (iteration order is not guaranteed)
         */
        var toPairs = createToPairs(keys);

        /**
         * Creates an array of own and inherited enumerable string keyed-value pairs
         * for `object` which can be consumed by `_.fromPairs`. If `object` is a map
         * or set, its entries are returned.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @alias entriesIn
         * @category Object
         * @param {Object} object The object to query.
         * @returns {Array} Returns the key-value pairs.
         * @example
         *
         * function Foo() {
         *   this.a = 1;
         *   this.b = 2;
         * }
         *
         * Foo.prototype.c = 3;
         *
         * _.toPairsIn(new Foo);
         * // => [['a', 1], ['b', 2], ['c', 3]] (iteration order is not guaranteed)
         */
        var toPairsIn = createToPairs(keysIn);

        /**
         * An alternative to `_.reduce`; this method transforms `object` to a new
         * `accumulator` object which is the result of running each of its own
         * enumerable string keyed properties thru `iteratee`, with each invocation
         * potentially mutating the `accumulator` object. If `accumulator` is not
         * provided, a new object with the same `[[Prototype]]` will be used. The
         * iteratee is invoked with four arguments: (accumulator, value, key, object).
         * Iteratee functions may exit iteration early by explicitly returning `false`.
         *
         * @static
         * @memberOf _
         * @since 1.3.0
         * @category Object
         * @param {Object} object The object to iterate over.
         * @param {Function} [iteratee=_.identity] The function invoked per iteration.
         * @param {*} [accumulator] The custom accumulator value.
         * @returns {*} Returns the accumulated value.
         * @example
         *
         * _.transform([2, 3, 4], function(result, n) {
         *   result.push(n *= n);
         *   return n % 2 == 0;
         * }, []);
         * // => [4, 9]
         *
         * _.transform({ 'a': 1, 'b': 2, 'c': 1 }, function(result, value, key) {
         *   (result[value] || (result[value] = [])).push(key);
         * }, {});
         * // => { '1': ['a', 'c'], '2': ['b'] }
         */
        function transform(object, iteratee, accumulator) {
          var isArr = isArray(object),
              isArrLike = isArr || isBuffer(object) || isTypedArray(object);

          iteratee = getIteratee(iteratee, 4);
          if (accumulator == null) {
            var Ctor = object && object.constructor;
            if (isArrLike) {
              accumulator = isArr ? new Ctor : [];
            }
            else if (isObject(object)) {
              accumulator = isFunction(Ctor) ? baseCreate(getPrototype(object)) : {};
            }
            else {
              accumulator = {};
            }
          }
          (isArrLike ? arrayEach : baseForOwn)(object, function(value, index, object) {
            return iteratee(accumulator, value, index, object);
          });
          return accumulator;
        }

        /**
         * Removes the property at `path` of `object`.
         *
         * **Note:** This method mutates `object`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Object
         * @param {Object} object The object to modify.
         * @param {Array|string} path The path of the property to unset.
         * @returns {boolean} Returns `true` if the property is deleted, else `false`.
         * @example
         *
         * var object = { 'a': [{ 'b': { 'c': 7 } }] };
         * _.unset(object, 'a[0].b.c');
         * // => true
         *
         * console.log(object);
         * // => { 'a': [{ 'b': {} }] };
         *
         * _.unset(object, ['a', '0', 'b', 'c']);
         * // => true
         *
         * console.log(object);
         * // => { 'a': [{ 'b': {} }] };
         */
        function unset(object, path) {
          return object == null ? true : baseUnset(object, path);
        }

        /**
         * This method is like `_.set` except that accepts `updater` to produce the
         * value to set. Use `_.updateWith` to customize `path` creation. The `updater`
         * is invoked with one argument: (value).
         *
         * **Note:** This method mutates `object`.
         *
         * @static
         * @memberOf _
         * @since 4.6.0
         * @category Object
         * @param {Object} object The object to modify.
         * @param {Array|string} path The path of the property to set.
         * @param {Function} updater The function to produce the updated value.
         * @returns {Object} Returns `object`.
         * @example
         *
         * var object = { 'a': [{ 'b': { 'c': 3 } }] };
         *
         * _.update(object, 'a[0].b.c', function(n) { return n * n; });
         * console.log(object.a[0].b.c);
         * // => 9
         *
         * _.update(object, 'x[0].y.z', function(n) { return n ? n + 1 : 0; });
         * console.log(object.x[0].y.z);
         * // => 0
         */
        function update(object, path, updater) {
          return object == null ? object : baseUpdate(object, path, castFunction(updater));
        }

        /**
         * This method is like `_.update` except that it accepts `customizer` which is
         * invoked to produce the objects of `path`.  If `customizer` returns `undefined`
         * path creation is handled by the method instead. The `customizer` is invoked
         * with three arguments: (nsValue, key, nsObject).
         *
         * **Note:** This method mutates `object`.
         *
         * @static
         * @memberOf _
         * @since 4.6.0
         * @category Object
         * @param {Object} object The object to modify.
         * @param {Array|string} path The path of the property to set.
         * @param {Function} updater The function to produce the updated value.
         * @param {Function} [customizer] The function to customize assigned values.
         * @returns {Object} Returns `object`.
         * @example
         *
         * var object = {};
         *
         * _.updateWith(object, '[0][1]', _.constant('a'), Object);
         * // => { '0': { '1': 'a' } }
         */
        function updateWith(object, path, updater, customizer) {
          customizer = typeof customizer == 'function' ? customizer : undefined$1;
          return object == null ? object : baseUpdate(object, path, castFunction(updater), customizer);
        }

        /**
         * Creates an array of the own enumerable string keyed property values of `object`.
         *
         * **Note:** Non-object values are coerced to objects.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Object
         * @param {Object} object The object to query.
         * @returns {Array} Returns the array of property values.
         * @example
         *
         * function Foo() {
         *   this.a = 1;
         *   this.b = 2;
         * }
         *
         * Foo.prototype.c = 3;
         *
         * _.values(new Foo);
         * // => [1, 2] (iteration order is not guaranteed)
         *
         * _.values('hi');
         * // => ['h', 'i']
         */
        function values(object) {
          return object == null ? [] : baseValues(object, keys(object));
        }

        /**
         * Creates an array of the own and inherited enumerable string keyed property
         * values of `object`.
         *
         * **Note:** Non-object values are coerced to objects.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Object
         * @param {Object} object The object to query.
         * @returns {Array} Returns the array of property values.
         * @example
         *
         * function Foo() {
         *   this.a = 1;
         *   this.b = 2;
         * }
         *
         * Foo.prototype.c = 3;
         *
         * _.valuesIn(new Foo);
         * // => [1, 2, 3] (iteration order is not guaranteed)
         */
        function valuesIn(object) {
          return object == null ? [] : baseValues(object, keysIn(object));
        }

        /*------------------------------------------------------------------------*/

        /**
         * Clamps `number` within the inclusive `lower` and `upper` bounds.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Number
         * @param {number} number The number to clamp.
         * @param {number} [lower] The lower bound.
         * @param {number} upper The upper bound.
         * @returns {number} Returns the clamped number.
         * @example
         *
         * _.clamp(-10, -5, 5);
         * // => -5
         *
         * _.clamp(10, -5, 5);
         * // => 5
         */
        function clamp(number, lower, upper) {
          if (upper === undefined$1) {
            upper = lower;
            lower = undefined$1;
          }
          if (upper !== undefined$1) {
            upper = toNumber(upper);
            upper = upper === upper ? upper : 0;
          }
          if (lower !== undefined$1) {
            lower = toNumber(lower);
            lower = lower === lower ? lower : 0;
          }
          return baseClamp(toNumber(number), lower, upper);
        }

        /**
         * Checks if `n` is between `start` and up to, but not including, `end`. If
         * `end` is not specified, it's set to `start` with `start` then set to `0`.
         * If `start` is greater than `end` the params are swapped to support
         * negative ranges.
         *
         * @static
         * @memberOf _
         * @since 3.3.0
         * @category Number
         * @param {number} number The number to check.
         * @param {number} [start=0] The start of the range.
         * @param {number} end The end of the range.
         * @returns {boolean} Returns `true` if `number` is in the range, else `false`.
         * @see _.range, _.rangeRight
         * @example
         *
         * _.inRange(3, 2, 4);
         * // => true
         *
         * _.inRange(4, 8);
         * // => true
         *
         * _.inRange(4, 2);
         * // => false
         *
         * _.inRange(2, 2);
         * // => false
         *
         * _.inRange(1.2, 2);
         * // => true
         *
         * _.inRange(5.2, 4);
         * // => false
         *
         * _.inRange(-3, -2, -6);
         * // => true
         */
        function inRange(number, start, end) {
          start = toFinite(start);
          if (end === undefined$1) {
            end = start;
            start = 0;
          } else {
            end = toFinite(end);
          }
          number = toNumber(number);
          return baseInRange(number, start, end);
        }

        /**
         * Produces a random number between the inclusive `lower` and `upper` bounds.
         * If only one argument is provided a number between `0` and the given number
         * is returned. If `floating` is `true`, or either `lower` or `upper` are
         * floats, a floating-point number is returned instead of an integer.
         *
         * **Note:** JavaScript follows the IEEE-754 standard for resolving
         * floating-point values which can produce unexpected results.
         *
         * @static
         * @memberOf _
         * @since 0.7.0
         * @category Number
         * @param {number} [lower=0] The lower bound.
         * @param {number} [upper=1] The upper bound.
         * @param {boolean} [floating] Specify returning a floating-point number.
         * @returns {number} Returns the random number.
         * @example
         *
         * _.random(0, 5);
         * // => an integer between 0 and 5
         *
         * _.random(5);
         * // => also an integer between 0 and 5
         *
         * _.random(5, true);
         * // => a floating-point number between 0 and 5
         *
         * _.random(1.2, 5.2);
         * // => a floating-point number between 1.2 and 5.2
         */
        function random(lower, upper, floating) {
          if (floating && typeof floating != 'boolean' && isIterateeCall(lower, upper, floating)) {
            upper = floating = undefined$1;
          }
          if (floating === undefined$1) {
            if (typeof upper == 'boolean') {
              floating = upper;
              upper = undefined$1;
            }
            else if (typeof lower == 'boolean') {
              floating = lower;
              lower = undefined$1;
            }
          }
          if (lower === undefined$1 && upper === undefined$1) {
            lower = 0;
            upper = 1;
          }
          else {
            lower = toFinite(lower);
            if (upper === undefined$1) {
              upper = lower;
              lower = 0;
            } else {
              upper = toFinite(upper);
            }
          }
          if (lower > upper) {
            var temp = lower;
            lower = upper;
            upper = temp;
          }
          if (floating || lower % 1 || upper % 1) {
            var rand = nativeRandom();
            return nativeMin(lower + (rand * (upper - lower + freeParseFloat('1e-' + ((rand + '').length - 1)))), upper);
          }
          return baseRandom(lower, upper);
        }

        /*------------------------------------------------------------------------*/

        /**
         * Converts `string` to [camel case](https://en.wikipedia.org/wiki/CamelCase).
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category String
         * @param {string} [string=''] The string to convert.
         * @returns {string} Returns the camel cased string.
         * @example
         *
         * _.camelCase('Foo Bar');
         * // => 'fooBar'
         *
         * _.camelCase('--foo-bar--');
         * // => 'fooBar'
         *
         * _.camelCase('__FOO_BAR__');
         * // => 'fooBar'
         */
        var camelCase = createCompounder(function(result, word, index) {
          word = word.toLowerCase();
          return result + (index ? capitalize(word) : word);
        });

        /**
         * Converts the first character of `string` to upper case and the remaining
         * to lower case.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category String
         * @param {string} [string=''] The string to capitalize.
         * @returns {string} Returns the capitalized string.
         * @example
         *
         * _.capitalize('FRED');
         * // => 'Fred'
         */
        function capitalize(string) {
          return upperFirst(toString(string).toLowerCase());
        }

        /**
         * Deburrs `string` by converting
         * [Latin-1 Supplement](https://en.wikipedia.org/wiki/Latin-1_Supplement_(Unicode_block)#Character_table)
         * and [Latin Extended-A](https://en.wikipedia.org/wiki/Latin_Extended-A)
         * letters to basic Latin letters and removing
         * [combining diacritical marks](https://en.wikipedia.org/wiki/Combining_Diacritical_Marks).
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category String
         * @param {string} [string=''] The string to deburr.
         * @returns {string} Returns the deburred string.
         * @example
         *
         * _.deburr('déjà vu');
         * // => 'deja vu'
         */
        function deburr(string) {
          string = toString(string);
          return string && string.replace(reLatin, deburrLetter).replace(reComboMark, '');
        }

        /**
         * Checks if `string` ends with the given target string.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category String
         * @param {string} [string=''] The string to inspect.
         * @param {string} [target] The string to search for.
         * @param {number} [position=string.length] The position to search up to.
         * @returns {boolean} Returns `true` if `string` ends with `target`,
         *  else `false`.
         * @example
         *
         * _.endsWith('abc', 'c');
         * // => true
         *
         * _.endsWith('abc', 'b');
         * // => false
         *
         * _.endsWith('abc', 'b', 2);
         * // => true
         */
        function endsWith(string, target, position) {
          string = toString(string);
          target = baseToString(target);

          var length = string.length;
          position = position === undefined$1
            ? length
            : baseClamp(toInteger(position), 0, length);

          var end = position;
          position -= target.length;
          return position >= 0 && string.slice(position, end) == target;
        }

        /**
         * Converts the characters "&", "<", ">", '"', and "'" in `string` to their
         * corresponding HTML entities.
         *
         * **Note:** No other characters are escaped. To escape additional
         * characters use a third-party library like [_he_](https://mths.be/he).
         *
         * Though the ">" character is escaped for symmetry, characters like
         * ">" and "/" don't need escaping in HTML and have no special meaning
         * unless they're part of a tag or unquoted attribute value. See
         * [Mathias Bynens's article](https://mathiasbynens.be/notes/ambiguous-ampersands)
         * (under "semi-related fun fact") for more details.
         *
         * When working with HTML you should always
         * [quote attribute values](http://wonko.com/post/html-escaping) to reduce
         * XSS vectors.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category String
         * @param {string} [string=''] The string to escape.
         * @returns {string} Returns the escaped string.
         * @example
         *
         * _.escape('fred, barney, & pebbles');
         * // => 'fred, barney, &amp; pebbles'
         */
        function escape(string) {
          string = toString(string);
          return (string && reHasUnescapedHtml.test(string))
            ? string.replace(reUnescapedHtml, escapeHtmlChar)
            : string;
        }

        /**
         * Escapes the `RegExp` special characters "^", "$", "\", ".", "*", "+",
         * "?", "(", ")", "[", "]", "{", "}", and "|" in `string`.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category String
         * @param {string} [string=''] The string to escape.
         * @returns {string} Returns the escaped string.
         * @example
         *
         * _.escapeRegExp('[lodash](https://lodash.com/)');
         * // => '\[lodash\]\(https://lodash\.com/\)'
         */
        function escapeRegExp(string) {
          string = toString(string);
          return (string && reHasRegExpChar.test(string))
            ? string.replace(reRegExpChar, '\\$&')
            : string;
        }

        /**
         * Converts `string` to
         * [kebab case](https://en.wikipedia.org/wiki/Letter_case#Special_case_styles).
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category String
         * @param {string} [string=''] The string to convert.
         * @returns {string} Returns the kebab cased string.
         * @example
         *
         * _.kebabCase('Foo Bar');
         * // => 'foo-bar'
         *
         * _.kebabCase('fooBar');
         * // => 'foo-bar'
         *
         * _.kebabCase('__FOO_BAR__');
         * // => 'foo-bar'
         */
        var kebabCase = createCompounder(function(result, word, index) {
          return result + (index ? '-' : '') + word.toLowerCase();
        });

        /**
         * Converts `string`, as space separated words, to lower case.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category String
         * @param {string} [string=''] The string to convert.
         * @returns {string} Returns the lower cased string.
         * @example
         *
         * _.lowerCase('--Foo-Bar--');
         * // => 'foo bar'
         *
         * _.lowerCase('fooBar');
         * // => 'foo bar'
         *
         * _.lowerCase('__FOO_BAR__');
         * // => 'foo bar'
         */
        var lowerCase = createCompounder(function(result, word, index) {
          return result + (index ? ' ' : '') + word.toLowerCase();
        });

        /**
         * Converts the first character of `string` to lower case.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category String
         * @param {string} [string=''] The string to convert.
         * @returns {string} Returns the converted string.
         * @example
         *
         * _.lowerFirst('Fred');
         * // => 'fred'
         *
         * _.lowerFirst('FRED');
         * // => 'fRED'
         */
        var lowerFirst = createCaseFirst('toLowerCase');

        /**
         * Pads `string` on the left and right sides if it's shorter than `length`.
         * Padding characters are truncated if they can't be evenly divided by `length`.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category String
         * @param {string} [string=''] The string to pad.
         * @param {number} [length=0] The padding length.
         * @param {string} [chars=' '] The string used as padding.
         * @returns {string} Returns the padded string.
         * @example
         *
         * _.pad('abc', 8);
         * // => '  abc   '
         *
         * _.pad('abc', 8, '_-');
         * // => '_-abc_-_'
         *
         * _.pad('abc', 3);
         * // => 'abc'
         */
        function pad(string, length, chars) {
          string = toString(string);
          length = toInteger(length);

          var strLength = length ? stringSize(string) : 0;
          if (!length || strLength >= length) {
            return string;
          }
          var mid = (length - strLength) / 2;
          return (
            createPadding(nativeFloor(mid), chars) +
            string +
            createPadding(nativeCeil(mid), chars)
          );
        }

        /**
         * Pads `string` on the right side if it's shorter than `length`. Padding
         * characters are truncated if they exceed `length`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category String
         * @param {string} [string=''] The string to pad.
         * @param {number} [length=0] The padding length.
         * @param {string} [chars=' '] The string used as padding.
         * @returns {string} Returns the padded string.
         * @example
         *
         * _.padEnd('abc', 6);
         * // => 'abc   '
         *
         * _.padEnd('abc', 6, '_-');
         * // => 'abc_-_'
         *
         * _.padEnd('abc', 3);
         * // => 'abc'
         */
        function padEnd(string, length, chars) {
          string = toString(string);
          length = toInteger(length);

          var strLength = length ? stringSize(string) : 0;
          return (length && strLength < length)
            ? (string + createPadding(length - strLength, chars))
            : string;
        }

        /**
         * Pads `string` on the left side if it's shorter than `length`. Padding
         * characters are truncated if they exceed `length`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category String
         * @param {string} [string=''] The string to pad.
         * @param {number} [length=0] The padding length.
         * @param {string} [chars=' '] The string used as padding.
         * @returns {string} Returns the padded string.
         * @example
         *
         * _.padStart('abc', 6);
         * // => '   abc'
         *
         * _.padStart('abc', 6, '_-');
         * // => '_-_abc'
         *
         * _.padStart('abc', 3);
         * // => 'abc'
         */
        function padStart(string, length, chars) {
          string = toString(string);
          length = toInteger(length);

          var strLength = length ? stringSize(string) : 0;
          return (length && strLength < length)
            ? (createPadding(length - strLength, chars) + string)
            : string;
        }

        /**
         * Converts `string` to an integer of the specified radix. If `radix` is
         * `undefined` or `0`, a `radix` of `10` is used unless `value` is a
         * hexadecimal, in which case a `radix` of `16` is used.
         *
         * **Note:** This method aligns with the
         * [ES5 implementation](https://es5.github.io/#x15.1.2.2) of `parseInt`.
         *
         * @static
         * @memberOf _
         * @since 1.1.0
         * @category String
         * @param {string} string The string to convert.
         * @param {number} [radix=10] The radix to interpret `value` by.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {number} Returns the converted integer.
         * @example
         *
         * _.parseInt('08');
         * // => 8
         *
         * _.map(['6', '08', '10'], _.parseInt);
         * // => [6, 8, 10]
         */
        function parseInt(string, radix, guard) {
          if (guard || radix == null) {
            radix = 0;
          } else if (radix) {
            radix = +radix;
          }
          return nativeParseInt(toString(string).replace(reTrimStart, ''), radix || 0);
        }

        /**
         * Repeats the given string `n` times.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category String
         * @param {string} [string=''] The string to repeat.
         * @param {number} [n=1] The number of times to repeat the string.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {string} Returns the repeated string.
         * @example
         *
         * _.repeat('*', 3);
         * // => '***'
         *
         * _.repeat('abc', 2);
         * // => 'abcabc'
         *
         * _.repeat('abc', 0);
         * // => ''
         */
        function repeat(string, n, guard) {
          if ((guard ? isIterateeCall(string, n, guard) : n === undefined$1)) {
            n = 1;
          } else {
            n = toInteger(n);
          }
          return baseRepeat(toString(string), n);
        }

        /**
         * Replaces matches for `pattern` in `string` with `replacement`.
         *
         * **Note:** This method is based on
         * [`String#replace`](https://mdn.io/String/replace).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category String
         * @param {string} [string=''] The string to modify.
         * @param {RegExp|string} pattern The pattern to replace.
         * @param {Function|string} replacement The match replacement.
         * @returns {string} Returns the modified string.
         * @example
         *
         * _.replace('Hi Fred', 'Fred', 'Barney');
         * // => 'Hi Barney'
         */
        function replace() {
          var args = arguments,
              string = toString(args[0]);

          return args.length < 3 ? string : string.replace(args[1], args[2]);
        }

        /**
         * Converts `string` to
         * [snake case](https://en.wikipedia.org/wiki/Snake_case).
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category String
         * @param {string} [string=''] The string to convert.
         * @returns {string} Returns the snake cased string.
         * @example
         *
         * _.snakeCase('Foo Bar');
         * // => 'foo_bar'
         *
         * _.snakeCase('fooBar');
         * // => 'foo_bar'
         *
         * _.snakeCase('--FOO-BAR--');
         * // => 'foo_bar'
         */
        var snakeCase = createCompounder(function(result, word, index) {
          return result + (index ? '_' : '') + word.toLowerCase();
        });

        /**
         * Splits `string` by `separator`.
         *
         * **Note:** This method is based on
         * [`String#split`](https://mdn.io/String/split).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category String
         * @param {string} [string=''] The string to split.
         * @param {RegExp|string} separator The separator pattern to split by.
         * @param {number} [limit] The length to truncate results to.
         * @returns {Array} Returns the string segments.
         * @example
         *
         * _.split('a-b-c', '-', 2);
         * // => ['a', 'b']
         */
        function split(string, separator, limit) {
          if (limit && typeof limit != 'number' && isIterateeCall(string, separator, limit)) {
            separator = limit = undefined$1;
          }
          limit = limit === undefined$1 ? MAX_ARRAY_LENGTH : limit >>> 0;
          if (!limit) {
            return [];
          }
          string = toString(string);
          if (string && (
                typeof separator == 'string' ||
                (separator != null && !isRegExp(separator))
              )) {
            separator = baseToString(separator);
            if (!separator && hasUnicode(string)) {
              return castSlice(stringToArray(string), 0, limit);
            }
          }
          return string.split(separator, limit);
        }

        /**
         * Converts `string` to
         * [start case](https://en.wikipedia.org/wiki/Letter_case#Stylistic_or_specialised_usage).
         *
         * @static
         * @memberOf _
         * @since 3.1.0
         * @category String
         * @param {string} [string=''] The string to convert.
         * @returns {string} Returns the start cased string.
         * @example
         *
         * _.startCase('--foo-bar--');
         * // => 'Foo Bar'
         *
         * _.startCase('fooBar');
         * // => 'Foo Bar'
         *
         * _.startCase('__FOO_BAR__');
         * // => 'FOO BAR'
         */
        var startCase = createCompounder(function(result, word, index) {
          return result + (index ? ' ' : '') + upperFirst(word);
        });

        /**
         * Checks if `string` starts with the given target string.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category String
         * @param {string} [string=''] The string to inspect.
         * @param {string} [target] The string to search for.
         * @param {number} [position=0] The position to search from.
         * @returns {boolean} Returns `true` if `string` starts with `target`,
         *  else `false`.
         * @example
         *
         * _.startsWith('abc', 'a');
         * // => true
         *
         * _.startsWith('abc', 'b');
         * // => false
         *
         * _.startsWith('abc', 'b', 1);
         * // => true
         */
        function startsWith(string, target, position) {
          string = toString(string);
          position = position == null
            ? 0
            : baseClamp(toInteger(position), 0, string.length);

          target = baseToString(target);
          return string.slice(position, position + target.length) == target;
        }

        /**
         * Creates a compiled template function that can interpolate data properties
         * in "interpolate" delimiters, HTML-escape interpolated data properties in
         * "escape" delimiters, and execute JavaScript in "evaluate" delimiters. Data
         * properties may be accessed as free variables in the template. If a setting
         * object is given, it takes precedence over `_.templateSettings` values.
         *
         * **Note:** In the development build `_.template` utilizes
         * [sourceURLs](http://www.html5rocks.com/en/tutorials/developertools/sourcemaps/#toc-sourceurl)
         * for easier debugging.
         *
         * For more information on precompiling templates see
         * [lodash's custom builds documentation](https://lodash.com/custom-builds).
         *
         * For more information on Chrome extension sandboxes see
         * [Chrome's extensions documentation](https://developer.chrome.com/extensions/sandboxingEval).
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category String
         * @param {string} [string=''] The template string.
         * @param {Object} [options={}] The options object.
         * @param {RegExp} [options.escape=_.templateSettings.escape]
         *  The HTML "escape" delimiter.
         * @param {RegExp} [options.evaluate=_.templateSettings.evaluate]
         *  The "evaluate" delimiter.
         * @param {Object} [options.imports=_.templateSettings.imports]
         *  An object to import into the template as free variables.
         * @param {RegExp} [options.interpolate=_.templateSettings.interpolate]
         *  The "interpolate" delimiter.
         * @param {string} [options.sourceURL='lodash.templateSources[n]']
         *  The sourceURL of the compiled template.
         * @param {string} [options.variable='obj']
         *  The data object variable name.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {Function} Returns the compiled template function.
         * @example
         *
         * // Use the "interpolate" delimiter to create a compiled template.
         * var compiled = _.template('hello <%= user %>!');
         * compiled({ 'user': 'fred' });
         * // => 'hello fred!'
         *
         * // Use the HTML "escape" delimiter to escape data property values.
         * var compiled = _.template('<b><%- value %></b>');
         * compiled({ 'value': '<script>' });
         * // => '<b>&lt;script&gt;</b>'
         *
         * // Use the "evaluate" delimiter to execute JavaScript and generate HTML.
         * var compiled = _.template('<% _.forEach(users, function(user) { %><li><%- user %></li><% }); %>');
         * compiled({ 'users': ['fred', 'barney'] });
         * // => '<li>fred</li><li>barney</li>'
         *
         * // Use the internal `print` function in "evaluate" delimiters.
         * var compiled = _.template('<% print("hello " + user); %>!');
         * compiled({ 'user': 'barney' });
         * // => 'hello barney!'
         *
         * // Use the ES template literal delimiter as an "interpolate" delimiter.
         * // Disable support by replacing the "interpolate" delimiter.
         * var compiled = _.template('hello ${ user }!');
         * compiled({ 'user': 'pebbles' });
         * // => 'hello pebbles!'
         *
         * // Use backslashes to treat delimiters as plain text.
         * var compiled = _.template('<%= "\\<%- value %\\>" %>');
         * compiled({ 'value': 'ignored' });
         * // => '<%- value %>'
         *
         * // Use the `imports` option to import `jQuery` as `jq`.
         * var text = '<% jq.each(users, function(user) { %><li><%- user %></li><% }); %>';
         * var compiled = _.template(text, { 'imports': { 'jq': jQuery } });
         * compiled({ 'users': ['fred', 'barney'] });
         * // => '<li>fred</li><li>barney</li>'
         *
         * // Use the `sourceURL` option to specify a custom sourceURL for the template.
         * var compiled = _.template('hello <%= user %>!', { 'sourceURL': '/basic/greeting.jst' });
         * compiled(data);
         * // => Find the source of "greeting.jst" under the Sources tab or Resources panel of the web inspector.
         *
         * // Use the `variable` option to ensure a with-statement isn't used in the compiled template.
         * var compiled = _.template('hi <%= data.user %>!', { 'variable': 'data' });
         * compiled.source;
         * // => function(data) {
         * //   var __t, __p = '';
         * //   __p += 'hi ' + ((__t = ( data.user )) == null ? '' : __t) + '!';
         * //   return __p;
         * // }
         *
         * // Use custom template delimiters.
         * _.templateSettings.interpolate = /{{([\s\S]+?)}}/g;
         * var compiled = _.template('hello {{ user }}!');
         * compiled({ 'user': 'mustache' });
         * // => 'hello mustache!'
         *
         * // Use the `source` property to inline compiled templates for meaningful
         * // line numbers in error messages and stack traces.
         * fs.writeFileSync(path.join(process.cwd(), 'jst.js'), '\
         *   var JST = {\
         *     "main": ' + _.template(mainText).source + '\
         *   };\
         * ');
         */
        function template(string, options, guard) {
          // Based on John Resig's `tmpl` implementation
          // (http://ejohn.org/blog/javascript-micro-templating/)
          // and Laura Doktorova's doT.js (https://github.com/olado/doT).
          var settings = lodash.templateSettings;

          if (guard && isIterateeCall(string, options, guard)) {
            options = undefined$1;
          }
          string = toString(string);
          options = assignInWith({}, options, settings, customDefaultsAssignIn);

          var imports = assignInWith({}, options.imports, settings.imports, customDefaultsAssignIn),
              importsKeys = keys(imports),
              importsValues = baseValues(imports, importsKeys);

          var isEscaping,
              isEvaluating,
              index = 0,
              interpolate = options.interpolate || reNoMatch,
              source = "__p += '";

          // Compile the regexp to match each delimiter.
          var reDelimiters = RegExp(
            (options.escape || reNoMatch).source + '|' +
            interpolate.source + '|' +
            (interpolate === reInterpolate ? reEsTemplate : reNoMatch).source + '|' +
            (options.evaluate || reNoMatch).source + '|$'
          , 'g');

          // Use a sourceURL for easier debugging.
          // The sourceURL gets injected into the source that's eval-ed, so be careful
          // to normalize all kinds of whitespace, so e.g. newlines (and unicode versions of it) can't sneak in
          // and escape the comment, thus injecting code that gets evaled.
          var sourceURL = '//# sourceURL=' +
            (hasOwnProperty.call(options, 'sourceURL')
              ? (options.sourceURL + '').replace(/\s/g, ' ')
              : ('lodash.templateSources[' + (++templateCounter) + ']')
            ) + '\n';

          string.replace(reDelimiters, function(match, escapeValue, interpolateValue, esTemplateValue, evaluateValue, offset) {
            interpolateValue || (interpolateValue = esTemplateValue);

            // Escape characters that can't be included in string literals.
            source += string.slice(index, offset).replace(reUnescapedString, escapeStringChar);

            // Replace delimiters with snippets.
            if (escapeValue) {
              isEscaping = true;
              source += "' +\n__e(" + escapeValue + ") +\n'";
            }
            if (evaluateValue) {
              isEvaluating = true;
              source += "';\n" + evaluateValue + ";\n__p += '";
            }
            if (interpolateValue) {
              source += "' +\n((__t = (" + interpolateValue + ")) == null ? '' : __t) +\n'";
            }
            index = offset + match.length;

            // The JS engine embedded in Adobe products needs `match` returned in
            // order to produce the correct `offset` value.
            return match;
          });

          source += "';\n";

          // If `variable` is not specified wrap a with-statement around the generated
          // code to add the data object to the top of the scope chain.
          var variable = hasOwnProperty.call(options, 'variable') && options.variable;
          if (!variable) {
            source = 'with (obj) {\n' + source + '\n}\n';
          }
          // Throw an error if a forbidden character was found in `variable`, to prevent
          // potential command injection attacks.
          else if (reForbiddenIdentifierChars.test(variable)) {
            throw new Error(INVALID_TEMPL_VAR_ERROR_TEXT);
          }

          // Cleanup code by stripping empty strings.
          source = (isEvaluating ? source.replace(reEmptyStringLeading, '') : source)
            .replace(reEmptyStringMiddle, '$1')
            .replace(reEmptyStringTrailing, '$1;');

          // Frame code as the function body.
          source = 'function(' + (variable || 'obj') + ') {\n' +
            (variable
              ? ''
              : 'obj || (obj = {});\n'
            ) +
            "var __t, __p = ''" +
            (isEscaping
               ? ', __e = _.escape'
               : ''
            ) +
            (isEvaluating
              ? ', __j = Array.prototype.join;\n' +
                "function print() { __p += __j.call(arguments, '') }\n"
              : ';\n'
            ) +
            source +
            'return __p\n}';

          var result = attempt(function() {
            return Function(importsKeys, sourceURL + 'return ' + source)
              .apply(undefined$1, importsValues);
          });

          // Provide the compiled function's source by its `toString` method or
          // the `source` property as a convenience for inlining compiled templates.
          result.source = source;
          if (isError(result)) {
            throw result;
          }
          return result;
        }

        /**
         * Converts `string`, as a whole, to lower case just like
         * [String#toLowerCase](https://mdn.io/toLowerCase).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category String
         * @param {string} [string=''] The string to convert.
         * @returns {string} Returns the lower cased string.
         * @example
         *
         * _.toLower('--Foo-Bar--');
         * // => '--foo-bar--'
         *
         * _.toLower('fooBar');
         * // => 'foobar'
         *
         * _.toLower('__FOO_BAR__');
         * // => '__foo_bar__'
         */
        function toLower(value) {
          return toString(value).toLowerCase();
        }

        /**
         * Converts `string`, as a whole, to upper case just like
         * [String#toUpperCase](https://mdn.io/toUpperCase).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category String
         * @param {string} [string=''] The string to convert.
         * @returns {string} Returns the upper cased string.
         * @example
         *
         * _.toUpper('--foo-bar--');
         * // => '--FOO-BAR--'
         *
         * _.toUpper('fooBar');
         * // => 'FOOBAR'
         *
         * _.toUpper('__foo_bar__');
         * // => '__FOO_BAR__'
         */
        function toUpper(value) {
          return toString(value).toUpperCase();
        }

        /**
         * Removes leading and trailing whitespace or specified characters from `string`.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category String
         * @param {string} [string=''] The string to trim.
         * @param {string} [chars=whitespace] The characters to trim.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {string} Returns the trimmed string.
         * @example
         *
         * _.trim('  abc  ');
         * // => 'abc'
         *
         * _.trim('-_-abc-_-', '_-');
         * // => 'abc'
         *
         * _.map(['  foo  ', '  bar  '], _.trim);
         * // => ['foo', 'bar']
         */
        function trim(string, chars, guard) {
          string = toString(string);
          if (string && (guard || chars === undefined$1)) {
            return baseTrim(string);
          }
          if (!string || !(chars = baseToString(chars))) {
            return string;
          }
          var strSymbols = stringToArray(string),
              chrSymbols = stringToArray(chars),
              start = charsStartIndex(strSymbols, chrSymbols),
              end = charsEndIndex(strSymbols, chrSymbols) + 1;

          return castSlice(strSymbols, start, end).join('');
        }

        /**
         * Removes trailing whitespace or specified characters from `string`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category String
         * @param {string} [string=''] The string to trim.
         * @param {string} [chars=whitespace] The characters to trim.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {string} Returns the trimmed string.
         * @example
         *
         * _.trimEnd('  abc  ');
         * // => '  abc'
         *
         * _.trimEnd('-_-abc-_-', '_-');
         * // => '-_-abc'
         */
        function trimEnd(string, chars, guard) {
          string = toString(string);
          if (string && (guard || chars === undefined$1)) {
            return string.slice(0, trimmedEndIndex(string) + 1);
          }
          if (!string || !(chars = baseToString(chars))) {
            return string;
          }
          var strSymbols = stringToArray(string),
              end = charsEndIndex(strSymbols, stringToArray(chars)) + 1;

          return castSlice(strSymbols, 0, end).join('');
        }

        /**
         * Removes leading whitespace or specified characters from `string`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category String
         * @param {string} [string=''] The string to trim.
         * @param {string} [chars=whitespace] The characters to trim.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {string} Returns the trimmed string.
         * @example
         *
         * _.trimStart('  abc  ');
         * // => 'abc  '
         *
         * _.trimStart('-_-abc-_-', '_-');
         * // => 'abc-_-'
         */
        function trimStart(string, chars, guard) {
          string = toString(string);
          if (string && (guard || chars === undefined$1)) {
            return string.replace(reTrimStart, '');
          }
          if (!string || !(chars = baseToString(chars))) {
            return string;
          }
          var strSymbols = stringToArray(string),
              start = charsStartIndex(strSymbols, stringToArray(chars));

          return castSlice(strSymbols, start).join('');
        }

        /**
         * Truncates `string` if it's longer than the given maximum string length.
         * The last characters of the truncated string are replaced with the omission
         * string which defaults to "...".
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category String
         * @param {string} [string=''] The string to truncate.
         * @param {Object} [options={}] The options object.
         * @param {number} [options.length=30] The maximum string length.
         * @param {string} [options.omission='...'] The string to indicate text is omitted.
         * @param {RegExp|string} [options.separator] The separator pattern to truncate to.
         * @returns {string} Returns the truncated string.
         * @example
         *
         * _.truncate('hi-diddly-ho there, neighborino');
         * // => 'hi-diddly-ho there, neighbo...'
         *
         * _.truncate('hi-diddly-ho there, neighborino', {
         *   'length': 24,
         *   'separator': ' '
         * });
         * // => 'hi-diddly-ho there,...'
         *
         * _.truncate('hi-diddly-ho there, neighborino', {
         *   'length': 24,
         *   'separator': /,? +/
         * });
         * // => 'hi-diddly-ho there...'
         *
         * _.truncate('hi-diddly-ho there, neighborino', {
         *   'omission': ' [...]'
         * });
         * // => 'hi-diddly-ho there, neig [...]'
         */
        function truncate(string, options) {
          var length = DEFAULT_TRUNC_LENGTH,
              omission = DEFAULT_TRUNC_OMISSION;

          if (isObject(options)) {
            var separator = 'separator' in options ? options.separator : separator;
            length = 'length' in options ? toInteger(options.length) : length;
            omission = 'omission' in options ? baseToString(options.omission) : omission;
          }
          string = toString(string);

          var strLength = string.length;
          if (hasUnicode(string)) {
            var strSymbols = stringToArray(string);
            strLength = strSymbols.length;
          }
          if (length >= strLength) {
            return string;
          }
          var end = length - stringSize(omission);
          if (end < 1) {
            return omission;
          }
          var result = strSymbols
            ? castSlice(strSymbols, 0, end).join('')
            : string.slice(0, end);

          if (separator === undefined$1) {
            return result + omission;
          }
          if (strSymbols) {
            end += (result.length - end);
          }
          if (isRegExp(separator)) {
            if (string.slice(end).search(separator)) {
              var match,
                  substring = result;

              if (!separator.global) {
                separator = RegExp(separator.source, toString(reFlags.exec(separator)) + 'g');
              }
              separator.lastIndex = 0;
              while ((match = separator.exec(substring))) {
                var newEnd = match.index;
              }
              result = result.slice(0, newEnd === undefined$1 ? end : newEnd);
            }
          } else if (string.indexOf(baseToString(separator), end) != end) {
            var index = result.lastIndexOf(separator);
            if (index > -1) {
              result = result.slice(0, index);
            }
          }
          return result + omission;
        }

        /**
         * The inverse of `_.escape`; this method converts the HTML entities
         * `&amp;`, `&lt;`, `&gt;`, `&quot;`, and `&#39;` in `string` to
         * their corresponding characters.
         *
         * **Note:** No other HTML entities are unescaped. To unescape additional
         * HTML entities use a third-party library like [_he_](https://mths.be/he).
         *
         * @static
         * @memberOf _
         * @since 0.6.0
         * @category String
         * @param {string} [string=''] The string to unescape.
         * @returns {string} Returns the unescaped string.
         * @example
         *
         * _.unescape('fred, barney, &amp; pebbles');
         * // => 'fred, barney, & pebbles'
         */
        function unescape(string) {
          string = toString(string);
          return (string && reHasEscapedHtml.test(string))
            ? string.replace(reEscapedHtml, unescapeHtmlChar)
            : string;
        }

        /**
         * Converts `string`, as space separated words, to upper case.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category String
         * @param {string} [string=''] The string to convert.
         * @returns {string} Returns the upper cased string.
         * @example
         *
         * _.upperCase('--foo-bar');
         * // => 'FOO BAR'
         *
         * _.upperCase('fooBar');
         * // => 'FOO BAR'
         *
         * _.upperCase('__foo_bar__');
         * // => 'FOO BAR'
         */
        var upperCase = createCompounder(function(result, word, index) {
          return result + (index ? ' ' : '') + word.toUpperCase();
        });

        /**
         * Converts the first character of `string` to upper case.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category String
         * @param {string} [string=''] The string to convert.
         * @returns {string} Returns the converted string.
         * @example
         *
         * _.upperFirst('fred');
         * // => 'Fred'
         *
         * _.upperFirst('FRED');
         * // => 'FRED'
         */
        var upperFirst = createCaseFirst('toUpperCase');

        /**
         * Splits `string` into an array of its words.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category String
         * @param {string} [string=''] The string to inspect.
         * @param {RegExp|string} [pattern] The pattern to match words.
         * @param- {Object} [guard] Enables use as an iteratee for methods like `_.map`.
         * @returns {Array} Returns the words of `string`.
         * @example
         *
         * _.words('fred, barney, & pebbles');
         * // => ['fred', 'barney', 'pebbles']
         *
         * _.words('fred, barney, & pebbles', /[^, ]+/g);
         * // => ['fred', 'barney', '&', 'pebbles']
         */
        function words(string, pattern, guard) {
          string = toString(string);
          pattern = guard ? undefined$1 : pattern;

          if (pattern === undefined$1) {
            return hasUnicodeWord(string) ? unicodeWords(string) : asciiWords(string);
          }
          return string.match(pattern) || [];
        }

        /*------------------------------------------------------------------------*/

        /**
         * Attempts to invoke `func`, returning either the result or the caught error
         * object. Any additional arguments are provided to `func` when it's invoked.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Util
         * @param {Function} func The function to attempt.
         * @param {...*} [args] The arguments to invoke `func` with.
         * @returns {*} Returns the `func` result or error object.
         * @example
         *
         * // Avoid throwing errors for invalid selectors.
         * var elements = _.attempt(function(selector) {
         *   return document.querySelectorAll(selector);
         * }, '>_>');
         *
         * if (_.isError(elements)) {
         *   elements = [];
         * }
         */
        var attempt = baseRest(function(func, args) {
          try {
            return apply(func, undefined$1, args);
          } catch (e) {
            return isError(e) ? e : new Error(e);
          }
        });

        /**
         * Binds methods of an object to the object itself, overwriting the existing
         * method.
         *
         * **Note:** This method doesn't set the "length" property of bound functions.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Util
         * @param {Object} object The object to bind and assign the bound methods to.
         * @param {...(string|string[])} methodNames The object method names to bind.
         * @returns {Object} Returns `object`.
         * @example
         *
         * var view = {
         *   'label': 'docs',
         *   'click': function() {
         *     console.log('clicked ' + this.label);
         *   }
         * };
         *
         * _.bindAll(view, ['click']);
         * jQuery(element).on('click', view.click);
         * // => Logs 'clicked docs' when clicked.
         */
        var bindAll = flatRest(function(object, methodNames) {
          arrayEach(methodNames, function(key) {
            key = toKey(key);
            baseAssignValue(object, key, bind(object[key], object));
          });
          return object;
        });

        /**
         * Creates a function that iterates over `pairs` and invokes the corresponding
         * function of the first predicate to return truthy. The predicate-function
         * pairs are invoked with the `this` binding and arguments of the created
         * function.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Util
         * @param {Array} pairs The predicate-function pairs.
         * @returns {Function} Returns the new composite function.
         * @example
         *
         * var func = _.cond([
         *   [_.matches({ 'a': 1 }),           _.constant('matches A')],
         *   [_.conforms({ 'b': _.isNumber }), _.constant('matches B')],
         *   [_.stubTrue,                      _.constant('no match')]
         * ]);
         *
         * func({ 'a': 1, 'b': 2 });
         * // => 'matches A'
         *
         * func({ 'a': 0, 'b': 1 });
         * // => 'matches B'
         *
         * func({ 'a': '1', 'b': '2' });
         * // => 'no match'
         */
        function cond(pairs) {
          var length = pairs == null ? 0 : pairs.length,
              toIteratee = getIteratee();

          pairs = !length ? [] : arrayMap(pairs, function(pair) {
            if (typeof pair[1] != 'function') {
              throw new TypeError(FUNC_ERROR_TEXT);
            }
            return [toIteratee(pair[0]), pair[1]];
          });

          return baseRest(function(args) {
            var index = -1;
            while (++index < length) {
              var pair = pairs[index];
              if (apply(pair[0], this, args)) {
                return apply(pair[1], this, args);
              }
            }
          });
        }

        /**
         * Creates a function that invokes the predicate properties of `source` with
         * the corresponding property values of a given object, returning `true` if
         * all predicates return truthy, else `false`.
         *
         * **Note:** The created function is equivalent to `_.conformsTo` with
         * `source` partially applied.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Util
         * @param {Object} source The object of property predicates to conform to.
         * @returns {Function} Returns the new spec function.
         * @example
         *
         * var objects = [
         *   { 'a': 2, 'b': 1 },
         *   { 'a': 1, 'b': 2 }
         * ];
         *
         * _.filter(objects, _.conforms({ 'b': function(n) { return n > 1; } }));
         * // => [{ 'a': 1, 'b': 2 }]
         */
        function conforms(source) {
          return baseConforms(baseClone(source, CLONE_DEEP_FLAG));
        }

        /**
         * Creates a function that returns `value`.
         *
         * @static
         * @memberOf _
         * @since 2.4.0
         * @category Util
         * @param {*} value The value to return from the new function.
         * @returns {Function} Returns the new constant function.
         * @example
         *
         * var objects = _.times(2, _.constant({ 'a': 1 }));
         *
         * console.log(objects);
         * // => [{ 'a': 1 }, { 'a': 1 }]
         *
         * console.log(objects[0] === objects[1]);
         * // => true
         */
        function constant(value) {
          return function() {
            return value;
          };
        }

        /**
         * Checks `value` to determine whether a default value should be returned in
         * its place. The `defaultValue` is returned if `value` is `NaN`, `null`,
         * or `undefined`.
         *
         * @static
         * @memberOf _
         * @since 4.14.0
         * @category Util
         * @param {*} value The value to check.
         * @param {*} defaultValue The default value.
         * @returns {*} Returns the resolved value.
         * @example
         *
         * _.defaultTo(1, 10);
         * // => 1
         *
         * _.defaultTo(undefined, 10);
         * // => 10
         */
        function defaultTo(value, defaultValue) {
          return (value == null || value !== value) ? defaultValue : value;
        }

        /**
         * Creates a function that returns the result of invoking the given functions
         * with the `this` binding of the created function, where each successive
         * invocation is supplied the return value of the previous.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Util
         * @param {...(Function|Function[])} [funcs] The functions to invoke.
         * @returns {Function} Returns the new composite function.
         * @see _.flowRight
         * @example
         *
         * function square(n) {
         *   return n * n;
         * }
         *
         * var addSquare = _.flow([_.add, square]);
         * addSquare(1, 2);
         * // => 9
         */
        var flow = createFlow();

        /**
         * This method is like `_.flow` except that it creates a function that
         * invokes the given functions from right to left.
         *
         * @static
         * @since 3.0.0
         * @memberOf _
         * @category Util
         * @param {...(Function|Function[])} [funcs] The functions to invoke.
         * @returns {Function} Returns the new composite function.
         * @see _.flow
         * @example
         *
         * function square(n) {
         *   return n * n;
         * }
         *
         * var addSquare = _.flowRight([square, _.add]);
         * addSquare(1, 2);
         * // => 9
         */
        var flowRight = createFlow(true);

        /**
         * This method returns the first argument it receives.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Util
         * @param {*} value Any value.
         * @returns {*} Returns `value`.
         * @example
         *
         * var object = { 'a': 1 };
         *
         * console.log(_.identity(object) === object);
         * // => true
         */
        function identity(value) {
          return value;
        }

        /**
         * Creates a function that invokes `func` with the arguments of the created
         * function. If `func` is a property name, the created function returns the
         * property value for a given element. If `func` is an array or object, the
         * created function returns `true` for elements that contain the equivalent
         * source properties, otherwise it returns `false`.
         *
         * @static
         * @since 4.0.0
         * @memberOf _
         * @category Util
         * @param {*} [func=_.identity] The value to convert to a callback.
         * @returns {Function} Returns the callback.
         * @example
         *
         * var users = [
         *   { 'user': 'barney', 'age': 36, 'active': true },
         *   { 'user': 'fred',   'age': 40, 'active': false }
         * ];
         *
         * // The `_.matches` iteratee shorthand.
         * _.filter(users, _.iteratee({ 'user': 'barney', 'active': true }));
         * // => [{ 'user': 'barney', 'age': 36, 'active': true }]
         *
         * // The `_.matchesProperty` iteratee shorthand.
         * _.filter(users, _.iteratee(['user', 'fred']));
         * // => [{ 'user': 'fred', 'age': 40 }]
         *
         * // The `_.property` iteratee shorthand.
         * _.map(users, _.iteratee('user'));
         * // => ['barney', 'fred']
         *
         * // Create custom iteratee shorthands.
         * _.iteratee = _.wrap(_.iteratee, function(iteratee, func) {
         *   return !_.isRegExp(func) ? iteratee(func) : function(string) {
         *     return func.test(string);
         *   };
         * });
         *
         * _.filter(['abc', 'def'], /ef/);
         * // => ['def']
         */
        function iteratee(func) {
          return baseIteratee(typeof func == 'function' ? func : baseClone(func, CLONE_DEEP_FLAG));
        }

        /**
         * Creates a function that performs a partial deep comparison between a given
         * object and `source`, returning `true` if the given object has equivalent
         * property values, else `false`.
         *
         * **Note:** The created function is equivalent to `_.isMatch` with `source`
         * partially applied.
         *
         * Partial comparisons will match empty array and empty object `source`
         * values against any array or object value, respectively. See `_.isEqual`
         * for a list of supported value comparisons.
         *
         * **Note:** Multiple values can be checked by combining several matchers
         * using `_.overSome`
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Util
         * @param {Object} source The object of property values to match.
         * @returns {Function} Returns the new spec function.
         * @example
         *
         * var objects = [
         *   { 'a': 1, 'b': 2, 'c': 3 },
         *   { 'a': 4, 'b': 5, 'c': 6 }
         * ];
         *
         * _.filter(objects, _.matches({ 'a': 4, 'c': 6 }));
         * // => [{ 'a': 4, 'b': 5, 'c': 6 }]
         *
         * // Checking for several possible values
         * _.filter(objects, _.overSome([_.matches({ 'a': 1 }), _.matches({ 'a': 4 })]));
         * // => [{ 'a': 1, 'b': 2, 'c': 3 }, { 'a': 4, 'b': 5, 'c': 6 }]
         */
        function matches(source) {
          return baseMatches(baseClone(source, CLONE_DEEP_FLAG));
        }

        /**
         * Creates a function that performs a partial deep comparison between the
         * value at `path` of a given object to `srcValue`, returning `true` if the
         * object value is equivalent, else `false`.
         *
         * **Note:** Partial comparisons will match empty array and empty object
         * `srcValue` values against any array or object value, respectively. See
         * `_.isEqual` for a list of supported value comparisons.
         *
         * **Note:** Multiple values can be checked by combining several matchers
         * using `_.overSome`
         *
         * @static
         * @memberOf _
         * @since 3.2.0
         * @category Util
         * @param {Array|string} path The path of the property to get.
         * @param {*} srcValue The value to match.
         * @returns {Function} Returns the new spec function.
         * @example
         *
         * var objects = [
         *   { 'a': 1, 'b': 2, 'c': 3 },
         *   { 'a': 4, 'b': 5, 'c': 6 }
         * ];
         *
         * _.find(objects, _.matchesProperty('a', 4));
         * // => { 'a': 4, 'b': 5, 'c': 6 }
         *
         * // Checking for several possible values
         * _.filter(objects, _.overSome([_.matchesProperty('a', 1), _.matchesProperty('a', 4)]));
         * // => [{ 'a': 1, 'b': 2, 'c': 3 }, { 'a': 4, 'b': 5, 'c': 6 }]
         */
        function matchesProperty(path, srcValue) {
          return baseMatchesProperty(path, baseClone(srcValue, CLONE_DEEP_FLAG));
        }

        /**
         * Creates a function that invokes the method at `path` of a given object.
         * Any additional arguments are provided to the invoked method.
         *
         * @static
         * @memberOf _
         * @since 3.7.0
         * @category Util
         * @param {Array|string} path The path of the method to invoke.
         * @param {...*} [args] The arguments to invoke the method with.
         * @returns {Function} Returns the new invoker function.
         * @example
         *
         * var objects = [
         *   { 'a': { 'b': _.constant(2) } },
         *   { 'a': { 'b': _.constant(1) } }
         * ];
         *
         * _.map(objects, _.method('a.b'));
         * // => [2, 1]
         *
         * _.map(objects, _.method(['a', 'b']));
         * // => [2, 1]
         */
        var method = baseRest(function(path, args) {
          return function(object) {
            return baseInvoke(object, path, args);
          };
        });

        /**
         * The opposite of `_.method`; this method creates a function that invokes
         * the method at a given path of `object`. Any additional arguments are
         * provided to the invoked method.
         *
         * @static
         * @memberOf _
         * @since 3.7.0
         * @category Util
         * @param {Object} object The object to query.
         * @param {...*} [args] The arguments to invoke the method with.
         * @returns {Function} Returns the new invoker function.
         * @example
         *
         * var array = _.times(3, _.constant),
         *     object = { 'a': array, 'b': array, 'c': array };
         *
         * _.map(['a[2]', 'c[0]'], _.methodOf(object));
         * // => [2, 0]
         *
         * _.map([['a', '2'], ['c', '0']], _.methodOf(object));
         * // => [2, 0]
         */
        var methodOf = baseRest(function(object, args) {
          return function(path) {
            return baseInvoke(object, path, args);
          };
        });

        /**
         * Adds all own enumerable string keyed function properties of a source
         * object to the destination object. If `object` is a function, then methods
         * are added to its prototype as well.
         *
         * **Note:** Use `_.runInContext` to create a pristine `lodash` function to
         * avoid conflicts caused by modifying the original.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Util
         * @param {Function|Object} [object=lodash] The destination object.
         * @param {Object} source The object of functions to add.
         * @param {Object} [options={}] The options object.
         * @param {boolean} [options.chain=true] Specify whether mixins are chainable.
         * @returns {Function|Object} Returns `object`.
         * @example
         *
         * function vowels(string) {
         *   return _.filter(string, function(v) {
         *     return /[aeiou]/i.test(v);
         *   });
         * }
         *
         * _.mixin({ 'vowels': vowels });
         * _.vowels('fred');
         * // => ['e']
         *
         * _('fred').vowels().value();
         * // => ['e']
         *
         * _.mixin({ 'vowels': vowels }, { 'chain': false });
         * _('fred').vowels();
         * // => ['e']
         */
        function mixin(object, source, options) {
          var props = keys(source),
              methodNames = baseFunctions(source, props);

          if (options == null &&
              !(isObject(source) && (methodNames.length || !props.length))) {
            options = source;
            source = object;
            object = this;
            methodNames = baseFunctions(source, keys(source));
          }
          var chain = !(isObject(options) && 'chain' in options) || !!options.chain,
              isFunc = isFunction(object);

          arrayEach(methodNames, function(methodName) {
            var func = source[methodName];
            object[methodName] = func;
            if (isFunc) {
              object.prototype[methodName] = function() {
                var chainAll = this.__chain__;
                if (chain || chainAll) {
                  var result = object(this.__wrapped__),
                      actions = result.__actions__ = copyArray(this.__actions__);

                  actions.push({ 'func': func, 'args': arguments, 'thisArg': object });
                  result.__chain__ = chainAll;
                  return result;
                }
                return func.apply(object, arrayPush([this.value()], arguments));
              };
            }
          });

          return object;
        }

        /**
         * Reverts the `_` variable to its previous value and returns a reference to
         * the `lodash` function.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Util
         * @returns {Function} Returns the `lodash` function.
         * @example
         *
         * var lodash = _.noConflict();
         */
        function noConflict() {
          if (root._ === this) {
            root._ = oldDash;
          }
          return this;
        }

        /**
         * This method returns `undefined`.
         *
         * @static
         * @memberOf _
         * @since 2.3.0
         * @category Util
         * @example
         *
         * _.times(2, _.noop);
         * // => [undefined, undefined]
         */
        function noop() {
          // No operation performed.
        }

        /**
         * Creates a function that gets the argument at index `n`. If `n` is negative,
         * the nth argument from the end is returned.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Util
         * @param {number} [n=0] The index of the argument to return.
         * @returns {Function} Returns the new pass-thru function.
         * @example
         *
         * var func = _.nthArg(1);
         * func('a', 'b', 'c', 'd');
         * // => 'b'
         *
         * var func = _.nthArg(-2);
         * func('a', 'b', 'c', 'd');
         * // => 'c'
         */
        function nthArg(n) {
          n = toInteger(n);
          return baseRest(function(args) {
            return baseNth(args, n);
          });
        }

        /**
         * Creates a function that invokes `iteratees` with the arguments it receives
         * and returns their results.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Util
         * @param {...(Function|Function[])} [iteratees=[_.identity]]
         *  The iteratees to invoke.
         * @returns {Function} Returns the new function.
         * @example
         *
         * var func = _.over([Math.max, Math.min]);
         *
         * func(1, 2, 3, 4);
         * // => [4, 1]
         */
        var over = createOver(arrayMap);

        /**
         * Creates a function that checks if **all** of the `predicates` return
         * truthy when invoked with the arguments it receives.
         *
         * Following shorthands are possible for providing predicates.
         * Pass an `Object` and it will be used as an parameter for `_.matches` to create the predicate.
         * Pass an `Array` of parameters for `_.matchesProperty` and the predicate will be created using them.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Util
         * @param {...(Function|Function[])} [predicates=[_.identity]]
         *  The predicates to check.
         * @returns {Function} Returns the new function.
         * @example
         *
         * var func = _.overEvery([Boolean, isFinite]);
         *
         * func('1');
         * // => true
         *
         * func(null);
         * // => false
         *
         * func(NaN);
         * // => false
         */
        var overEvery = createOver(arrayEvery);

        /**
         * Creates a function that checks if **any** of the `predicates` return
         * truthy when invoked with the arguments it receives.
         *
         * Following shorthands are possible for providing predicates.
         * Pass an `Object` and it will be used as an parameter for `_.matches` to create the predicate.
         * Pass an `Array` of parameters for `_.matchesProperty` and the predicate will be created using them.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Util
         * @param {...(Function|Function[])} [predicates=[_.identity]]
         *  The predicates to check.
         * @returns {Function} Returns the new function.
         * @example
         *
         * var func = _.overSome([Boolean, isFinite]);
         *
         * func('1');
         * // => true
         *
         * func(null);
         * // => true
         *
         * func(NaN);
         * // => false
         *
         * var matchesFunc = _.overSome([{ 'a': 1 }, { 'a': 2 }])
         * var matchesPropertyFunc = _.overSome([['a', 1], ['a', 2]])
         */
        var overSome = createOver(arraySome);

        /**
         * Creates a function that returns the value at `path` of a given object.
         *
         * @static
         * @memberOf _
         * @since 2.4.0
         * @category Util
         * @param {Array|string} path The path of the property to get.
         * @returns {Function} Returns the new accessor function.
         * @example
         *
         * var objects = [
         *   { 'a': { 'b': 2 } },
         *   { 'a': { 'b': 1 } }
         * ];
         *
         * _.map(objects, _.property('a.b'));
         * // => [2, 1]
         *
         * _.map(_.sortBy(objects, _.property(['a', 'b'])), 'a.b');
         * // => [1, 2]
         */
        function property(path) {
          return isKey(path) ? baseProperty(toKey(path)) : basePropertyDeep(path);
        }

        /**
         * The opposite of `_.property`; this method creates a function that returns
         * the value at a given path of `object`.
         *
         * @static
         * @memberOf _
         * @since 3.0.0
         * @category Util
         * @param {Object} object The object to query.
         * @returns {Function} Returns the new accessor function.
         * @example
         *
         * var array = [0, 1, 2],
         *     object = { 'a': array, 'b': array, 'c': array };
         *
         * _.map(['a[2]', 'c[0]'], _.propertyOf(object));
         * // => [2, 0]
         *
         * _.map([['a', '2'], ['c', '0']], _.propertyOf(object));
         * // => [2, 0]
         */
        function propertyOf(object) {
          return function(path) {
            return object == null ? undefined$1 : baseGet(object, path);
          };
        }

        /**
         * Creates an array of numbers (positive and/or negative) progressing from
         * `start` up to, but not including, `end`. A step of `-1` is used if a negative
         * `start` is specified without an `end` or `step`. If `end` is not specified,
         * it's set to `start` with `start` then set to `0`.
         *
         * **Note:** JavaScript follows the IEEE-754 standard for resolving
         * floating-point values which can produce unexpected results.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Util
         * @param {number} [start=0] The start of the range.
         * @param {number} end The end of the range.
         * @param {number} [step=1] The value to increment or decrement by.
         * @returns {Array} Returns the range of numbers.
         * @see _.inRange, _.rangeRight
         * @example
         *
         * _.range(4);
         * // => [0, 1, 2, 3]
         *
         * _.range(-4);
         * // => [0, -1, -2, -3]
         *
         * _.range(1, 5);
         * // => [1, 2, 3, 4]
         *
         * _.range(0, 20, 5);
         * // => [0, 5, 10, 15]
         *
         * _.range(0, -4, -1);
         * // => [0, -1, -2, -3]
         *
         * _.range(1, 4, 0);
         * // => [1, 1, 1]
         *
         * _.range(0);
         * // => []
         */
        var range = createRange();

        /**
         * This method is like `_.range` except that it populates values in
         * descending order.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Util
         * @param {number} [start=0] The start of the range.
         * @param {number} end The end of the range.
         * @param {number} [step=1] The value to increment or decrement by.
         * @returns {Array} Returns the range of numbers.
         * @see _.inRange, _.range
         * @example
         *
         * _.rangeRight(4);
         * // => [3, 2, 1, 0]
         *
         * _.rangeRight(-4);
         * // => [-3, -2, -1, 0]
         *
         * _.rangeRight(1, 5);
         * // => [4, 3, 2, 1]
         *
         * _.rangeRight(0, 20, 5);
         * // => [15, 10, 5, 0]
         *
         * _.rangeRight(0, -4, -1);
         * // => [-3, -2, -1, 0]
         *
         * _.rangeRight(1, 4, 0);
         * // => [1, 1, 1]
         *
         * _.rangeRight(0);
         * // => []
         */
        var rangeRight = createRange(true);

        /**
         * This method returns a new empty array.
         *
         * @static
         * @memberOf _
         * @since 4.13.0
         * @category Util
         * @returns {Array} Returns the new empty array.
         * @example
         *
         * var arrays = _.times(2, _.stubArray);
         *
         * console.log(arrays);
         * // => [[], []]
         *
         * console.log(arrays[0] === arrays[1]);
         * // => false
         */
        function stubArray() {
          return [];
        }

        /**
         * This method returns `false`.
         *
         * @static
         * @memberOf _
         * @since 4.13.0
         * @category Util
         * @returns {boolean} Returns `false`.
         * @example
         *
         * _.times(2, _.stubFalse);
         * // => [false, false]
         */
        function stubFalse() {
          return false;
        }

        /**
         * This method returns a new empty object.
         *
         * @static
         * @memberOf _
         * @since 4.13.0
         * @category Util
         * @returns {Object} Returns the new empty object.
         * @example
         *
         * var objects = _.times(2, _.stubObject);
         *
         * console.log(objects);
         * // => [{}, {}]
         *
         * console.log(objects[0] === objects[1]);
         * // => false
         */
        function stubObject() {
          return {};
        }

        /**
         * This method returns an empty string.
         *
         * @static
         * @memberOf _
         * @since 4.13.0
         * @category Util
         * @returns {string} Returns the empty string.
         * @example
         *
         * _.times(2, _.stubString);
         * // => ['', '']
         */
        function stubString() {
          return '';
        }

        /**
         * This method returns `true`.
         *
         * @static
         * @memberOf _
         * @since 4.13.0
         * @category Util
         * @returns {boolean} Returns `true`.
         * @example
         *
         * _.times(2, _.stubTrue);
         * // => [true, true]
         */
        function stubTrue() {
          return true;
        }

        /**
         * Invokes the iteratee `n` times, returning an array of the results of
         * each invocation. The iteratee is invoked with one argument; (index).
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Util
         * @param {number} n The number of times to invoke `iteratee`.
         * @param {Function} [iteratee=_.identity] The function invoked per iteration.
         * @returns {Array} Returns the array of results.
         * @example
         *
         * _.times(3, String);
         * // => ['0', '1', '2']
         *
         *  _.times(4, _.constant(0));
         * // => [0, 0, 0, 0]
         */
        function times(n, iteratee) {
          n = toInteger(n);
          if (n < 1 || n > MAX_SAFE_INTEGER) {
            return [];
          }
          var index = MAX_ARRAY_LENGTH,
              length = nativeMin(n, MAX_ARRAY_LENGTH);

          iteratee = getIteratee(iteratee);
          n -= MAX_ARRAY_LENGTH;

          var result = baseTimes(length, iteratee);
          while (++index < n) {
            iteratee(index);
          }
          return result;
        }

        /**
         * Converts `value` to a property path array.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Util
         * @param {*} value The value to convert.
         * @returns {Array} Returns the new property path array.
         * @example
         *
         * _.toPath('a.b.c');
         * // => ['a', 'b', 'c']
         *
         * _.toPath('a[0].b.c');
         * // => ['a', '0', 'b', 'c']
         */
        function toPath(value) {
          if (isArray(value)) {
            return arrayMap(value, toKey);
          }
          return isSymbol(value) ? [value] : copyArray(stringToPath(toString(value)));
        }

        /**
         * Generates a unique ID. If `prefix` is given, the ID is appended to it.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Util
         * @param {string} [prefix=''] The value to prefix the ID with.
         * @returns {string} Returns the unique ID.
         * @example
         *
         * _.uniqueId('contact_');
         * // => 'contact_104'
         *
         * _.uniqueId();
         * // => '105'
         */
        function uniqueId(prefix) {
          var id = ++idCounter;
          return toString(prefix) + id;
        }

        /*------------------------------------------------------------------------*/

        /**
         * Adds two numbers.
         *
         * @static
         * @memberOf _
         * @since 3.4.0
         * @category Math
         * @param {number} augend The first number in an addition.
         * @param {number} addend The second number in an addition.
         * @returns {number} Returns the total.
         * @example
         *
         * _.add(6, 4);
         * // => 10
         */
        var add = createMathOperation(function(augend, addend) {
          return augend + addend;
        }, 0);

        /**
         * Computes `number` rounded up to `precision`.
         *
         * @static
         * @memberOf _
         * @since 3.10.0
         * @category Math
         * @param {number} number The number to round up.
         * @param {number} [precision=0] The precision to round up to.
         * @returns {number} Returns the rounded up number.
         * @example
         *
         * _.ceil(4.006);
         * // => 5
         *
         * _.ceil(6.004, 2);
         * // => 6.01
         *
         * _.ceil(6040, -2);
         * // => 6100
         */
        var ceil = createRound('ceil');

        /**
         * Divide two numbers.
         *
         * @static
         * @memberOf _
         * @since 4.7.0
         * @category Math
         * @param {number} dividend The first number in a division.
         * @param {number} divisor The second number in a division.
         * @returns {number} Returns the quotient.
         * @example
         *
         * _.divide(6, 4);
         * // => 1.5
         */
        var divide = createMathOperation(function(dividend, divisor) {
          return dividend / divisor;
        }, 1);

        /**
         * Computes `number` rounded down to `precision`.
         *
         * @static
         * @memberOf _
         * @since 3.10.0
         * @category Math
         * @param {number} number The number to round down.
         * @param {number} [precision=0] The precision to round down to.
         * @returns {number} Returns the rounded down number.
         * @example
         *
         * _.floor(4.006);
         * // => 4
         *
         * _.floor(0.046, 2);
         * // => 0.04
         *
         * _.floor(4060, -2);
         * // => 4000
         */
        var floor = createRound('floor');

        /**
         * Computes the maximum value of `array`. If `array` is empty or falsey,
         * `undefined` is returned.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Math
         * @param {Array} array The array to iterate over.
         * @returns {*} Returns the maximum value.
         * @example
         *
         * _.max([4, 2, 8, 6]);
         * // => 8
         *
         * _.max([]);
         * // => undefined
         */
        function max(array) {
          return (array && array.length)
            ? baseExtremum(array, identity, baseGt)
            : undefined$1;
        }

        /**
         * This method is like `_.max` except that it accepts `iteratee` which is
         * invoked for each element in `array` to generate the criterion by which
         * the value is ranked. The iteratee is invoked with one argument: (value).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Math
         * @param {Array} array The array to iterate over.
         * @param {Function} [iteratee=_.identity] The iteratee invoked per element.
         * @returns {*} Returns the maximum value.
         * @example
         *
         * var objects = [{ 'n': 1 }, { 'n': 2 }];
         *
         * _.maxBy(objects, function(o) { return o.n; });
         * // => { 'n': 2 }
         *
         * // The `_.property` iteratee shorthand.
         * _.maxBy(objects, 'n');
         * // => { 'n': 2 }
         */
        function maxBy(array, iteratee) {
          return (array && array.length)
            ? baseExtremum(array, getIteratee(iteratee, 2), baseGt)
            : undefined$1;
        }

        /**
         * Computes the mean of the values in `array`.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Math
         * @param {Array} array The array to iterate over.
         * @returns {number} Returns the mean.
         * @example
         *
         * _.mean([4, 2, 8, 6]);
         * // => 5
         */
        function mean(array) {
          return baseMean(array, identity);
        }

        /**
         * This method is like `_.mean` except that it accepts `iteratee` which is
         * invoked for each element in `array` to generate the value to be averaged.
         * The iteratee is invoked with one argument: (value).
         *
         * @static
         * @memberOf _
         * @since 4.7.0
         * @category Math
         * @param {Array} array The array to iterate over.
         * @param {Function} [iteratee=_.identity] The iteratee invoked per element.
         * @returns {number} Returns the mean.
         * @example
         *
         * var objects = [{ 'n': 4 }, { 'n': 2 }, { 'n': 8 }, { 'n': 6 }];
         *
         * _.meanBy(objects, function(o) { return o.n; });
         * // => 5
         *
         * // The `_.property` iteratee shorthand.
         * _.meanBy(objects, 'n');
         * // => 5
         */
        function meanBy(array, iteratee) {
          return baseMean(array, getIteratee(iteratee, 2));
        }

        /**
         * Computes the minimum value of `array`. If `array` is empty or falsey,
         * `undefined` is returned.
         *
         * @static
         * @since 0.1.0
         * @memberOf _
         * @category Math
         * @param {Array} array The array to iterate over.
         * @returns {*} Returns the minimum value.
         * @example
         *
         * _.min([4, 2, 8, 6]);
         * // => 2
         *
         * _.min([]);
         * // => undefined
         */
        function min(array) {
          return (array && array.length)
            ? baseExtremum(array, identity, baseLt)
            : undefined$1;
        }

        /**
         * This method is like `_.min` except that it accepts `iteratee` which is
         * invoked for each element in `array` to generate the criterion by which
         * the value is ranked. The iteratee is invoked with one argument: (value).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Math
         * @param {Array} array The array to iterate over.
         * @param {Function} [iteratee=_.identity] The iteratee invoked per element.
         * @returns {*} Returns the minimum value.
         * @example
         *
         * var objects = [{ 'n': 1 }, { 'n': 2 }];
         *
         * _.minBy(objects, function(o) { return o.n; });
         * // => { 'n': 1 }
         *
         * // The `_.property` iteratee shorthand.
         * _.minBy(objects, 'n');
         * // => { 'n': 1 }
         */
        function minBy(array, iteratee) {
          return (array && array.length)
            ? baseExtremum(array, getIteratee(iteratee, 2), baseLt)
            : undefined$1;
        }

        /**
         * Multiply two numbers.
         *
         * @static
         * @memberOf _
         * @since 4.7.0
         * @category Math
         * @param {number} multiplier The first number in a multiplication.
         * @param {number} multiplicand The second number in a multiplication.
         * @returns {number} Returns the product.
         * @example
         *
         * _.multiply(6, 4);
         * // => 24
         */
        var multiply = createMathOperation(function(multiplier, multiplicand) {
          return multiplier * multiplicand;
        }, 1);

        /**
         * Computes `number` rounded to `precision`.
         *
         * @static
         * @memberOf _
         * @since 3.10.0
         * @category Math
         * @param {number} number The number to round.
         * @param {number} [precision=0] The precision to round to.
         * @returns {number} Returns the rounded number.
         * @example
         *
         * _.round(4.006);
         * // => 4
         *
         * _.round(4.006, 2);
         * // => 4.01
         *
         * _.round(4060, -2);
         * // => 4100
         */
        var round = createRound('round');

        /**
         * Subtract two numbers.
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Math
         * @param {number} minuend The first number in a subtraction.
         * @param {number} subtrahend The second number in a subtraction.
         * @returns {number} Returns the difference.
         * @example
         *
         * _.subtract(6, 4);
         * // => 2
         */
        var subtract = createMathOperation(function(minuend, subtrahend) {
          return minuend - subtrahend;
        }, 0);

        /**
         * Computes the sum of the values in `array`.
         *
         * @static
         * @memberOf _
         * @since 3.4.0
         * @category Math
         * @param {Array} array The array to iterate over.
         * @returns {number} Returns the sum.
         * @example
         *
         * _.sum([4, 2, 8, 6]);
         * // => 20
         */
        function sum(array) {
          return (array && array.length)
            ? baseSum(array, identity)
            : 0;
        }

        /**
         * This method is like `_.sum` except that it accepts `iteratee` which is
         * invoked for each element in `array` to generate the value to be summed.
         * The iteratee is invoked with one argument: (value).
         *
         * @static
         * @memberOf _
         * @since 4.0.0
         * @category Math
         * @param {Array} array The array to iterate over.
         * @param {Function} [iteratee=_.identity] The iteratee invoked per element.
         * @returns {number} Returns the sum.
         * @example
         *
         * var objects = [{ 'n': 4 }, { 'n': 2 }, { 'n': 8 }, { 'n': 6 }];
         *
         * _.sumBy(objects, function(o) { return o.n; });
         * // => 20
         *
         * // The `_.property` iteratee shorthand.
         * _.sumBy(objects, 'n');
         * // => 20
         */
        function sumBy(array, iteratee) {
          return (array && array.length)
            ? baseSum(array, getIteratee(iteratee, 2))
            : 0;
        }

        /*------------------------------------------------------------------------*/

        // Add methods that return wrapped values in chain sequences.
        lodash.after = after;
        lodash.ary = ary;
        lodash.assign = assign;
        lodash.assignIn = assignIn;
        lodash.assignInWith = assignInWith;
        lodash.assignWith = assignWith;
        lodash.at = at;
        lodash.before = before;
        lodash.bind = bind;
        lodash.bindAll = bindAll;
        lodash.bindKey = bindKey;
        lodash.castArray = castArray;
        lodash.chain = chain;
        lodash.chunk = chunk;
        lodash.compact = compact;
        lodash.concat = concat;
        lodash.cond = cond;
        lodash.conforms = conforms;
        lodash.constant = constant;
        lodash.countBy = countBy;
        lodash.create = create;
        lodash.curry = curry;
        lodash.curryRight = curryRight;
        lodash.debounce = debounce;
        lodash.defaults = defaults;
        lodash.defaultsDeep = defaultsDeep;
        lodash.defer = defer;
        lodash.delay = delay;
        lodash.difference = difference;
        lodash.differenceBy = differenceBy;
        lodash.differenceWith = differenceWith;
        lodash.drop = drop;
        lodash.dropRight = dropRight;
        lodash.dropRightWhile = dropRightWhile;
        lodash.dropWhile = dropWhile;
        lodash.fill = fill;
        lodash.filter = filter;
        lodash.flatMap = flatMap;
        lodash.flatMapDeep = flatMapDeep;
        lodash.flatMapDepth = flatMapDepth;
        lodash.flatten = flatten;
        lodash.flattenDeep = flattenDeep;
        lodash.flattenDepth = flattenDepth;
        lodash.flip = flip;
        lodash.flow = flow;
        lodash.flowRight = flowRight;
        lodash.fromPairs = fromPairs;
        lodash.functions = functions;
        lodash.functionsIn = functionsIn;
        lodash.groupBy = groupBy;
        lodash.initial = initial;
        lodash.intersection = intersection;
        lodash.intersectionBy = intersectionBy;
        lodash.intersectionWith = intersectionWith;
        lodash.invert = invert;
        lodash.invertBy = invertBy;
        lodash.invokeMap = invokeMap;
        lodash.iteratee = iteratee;
        lodash.keyBy = keyBy;
        lodash.keys = keys;
        lodash.keysIn = keysIn;
        lodash.map = map;
        lodash.mapKeys = mapKeys;
        lodash.mapValues = mapValues;
        lodash.matches = matches;
        lodash.matchesProperty = matchesProperty;
        lodash.memoize = memoize;
        lodash.merge = merge;
        lodash.mergeWith = mergeWith;
        lodash.method = method;
        lodash.methodOf = methodOf;
        lodash.mixin = mixin;
        lodash.negate = negate;
        lodash.nthArg = nthArg;
        lodash.omit = omit;
        lodash.omitBy = omitBy;
        lodash.once = once;
        lodash.orderBy = orderBy;
        lodash.over = over;
        lodash.overArgs = overArgs;
        lodash.overEvery = overEvery;
        lodash.overSome = overSome;
        lodash.partial = partial;
        lodash.partialRight = partialRight;
        lodash.partition = partition;
        lodash.pick = pick;
        lodash.pickBy = pickBy;
        lodash.property = property;
        lodash.propertyOf = propertyOf;
        lodash.pull = pull;
        lodash.pullAll = pullAll;
        lodash.pullAllBy = pullAllBy;
        lodash.pullAllWith = pullAllWith;
        lodash.pullAt = pullAt;
        lodash.range = range;
        lodash.rangeRight = rangeRight;
        lodash.rearg = rearg;
        lodash.reject = reject;
        lodash.remove = remove;
        lodash.rest = rest;
        lodash.reverse = reverse;
        lodash.sampleSize = sampleSize;
        lodash.set = set;
        lodash.setWith = setWith;
        lodash.shuffle = shuffle;
        lodash.slice = slice;
        lodash.sortBy = sortBy;
        lodash.sortedUniq = sortedUniq;
        lodash.sortedUniqBy = sortedUniqBy;
        lodash.split = split;
        lodash.spread = spread;
        lodash.tail = tail;
        lodash.take = take;
        lodash.takeRight = takeRight;
        lodash.takeRightWhile = takeRightWhile;
        lodash.takeWhile = takeWhile;
        lodash.tap = tap;
        lodash.throttle = throttle;
        lodash.thru = thru;
        lodash.toArray = toArray;
        lodash.toPairs = toPairs;
        lodash.toPairsIn = toPairsIn;
        lodash.toPath = toPath;
        lodash.toPlainObject = toPlainObject;
        lodash.transform = transform;
        lodash.unary = unary;
        lodash.union = union;
        lodash.unionBy = unionBy;
        lodash.unionWith = unionWith;
        lodash.uniq = uniq;
        lodash.uniqBy = uniqBy;
        lodash.uniqWith = uniqWith;
        lodash.unset = unset;
        lodash.unzip = unzip;
        lodash.unzipWith = unzipWith;
        lodash.update = update;
        lodash.updateWith = updateWith;
        lodash.values = values;
        lodash.valuesIn = valuesIn;
        lodash.without = without;
        lodash.words = words;
        lodash.wrap = wrap;
        lodash.xor = xor;
        lodash.xorBy = xorBy;
        lodash.xorWith = xorWith;
        lodash.zip = zip;
        lodash.zipObject = zipObject;
        lodash.zipObjectDeep = zipObjectDeep;
        lodash.zipWith = zipWith;

        // Add aliases.
        lodash.entries = toPairs;
        lodash.entriesIn = toPairsIn;
        lodash.extend = assignIn;
        lodash.extendWith = assignInWith;

        // Add methods to `lodash.prototype`.
        mixin(lodash, lodash);

        /*------------------------------------------------------------------------*/

        // Add methods that return unwrapped values in chain sequences.
        lodash.add = add;
        lodash.attempt = attempt;
        lodash.camelCase = camelCase;
        lodash.capitalize = capitalize;
        lodash.ceil = ceil;
        lodash.clamp = clamp;
        lodash.clone = clone;
        lodash.cloneDeep = cloneDeep;
        lodash.cloneDeepWith = cloneDeepWith;
        lodash.cloneWith = cloneWith;
        lodash.conformsTo = conformsTo;
        lodash.deburr = deburr;
        lodash.defaultTo = defaultTo;
        lodash.divide = divide;
        lodash.endsWith = endsWith;
        lodash.eq = eq;
        lodash.escape = escape;
        lodash.escapeRegExp = escapeRegExp;
        lodash.every = every;
        lodash.find = find;
        lodash.findIndex = findIndex;
        lodash.findKey = findKey;
        lodash.findLast = findLast;
        lodash.findLastIndex = findLastIndex;
        lodash.findLastKey = findLastKey;
        lodash.floor = floor;
        lodash.forEach = forEach;
        lodash.forEachRight = forEachRight;
        lodash.forIn = forIn;
        lodash.forInRight = forInRight;
        lodash.forOwn = forOwn;
        lodash.forOwnRight = forOwnRight;
        lodash.get = get;
        lodash.gt = gt;
        lodash.gte = gte;
        lodash.has = has;
        lodash.hasIn = hasIn;
        lodash.head = head;
        lodash.identity = identity;
        lodash.includes = includes;
        lodash.indexOf = indexOf;
        lodash.inRange = inRange;
        lodash.invoke = invoke;
        lodash.isArguments = isArguments;
        lodash.isArray = isArray;
        lodash.isArrayBuffer = isArrayBuffer;
        lodash.isArrayLike = isArrayLike;
        lodash.isArrayLikeObject = isArrayLikeObject;
        lodash.isBoolean = isBoolean;
        lodash.isBuffer = isBuffer;
        lodash.isDate = isDate;
        lodash.isElement = isElement;
        lodash.isEmpty = isEmpty;
        lodash.isEqual = isEqual;
        lodash.isEqualWith = isEqualWith;
        lodash.isError = isError;
        lodash.isFinite = isFinite;
        lodash.isFunction = isFunction;
        lodash.isInteger = isInteger;
        lodash.isLength = isLength;
        lodash.isMap = isMap;
        lodash.isMatch = isMatch;
        lodash.isMatchWith = isMatchWith;
        lodash.isNaN = isNaN;
        lodash.isNative = isNative;
        lodash.isNil = isNil;
        lodash.isNull = isNull;
        lodash.isNumber = isNumber;
        lodash.isObject = isObject;
        lodash.isObjectLike = isObjectLike;
        lodash.isPlainObject = isPlainObject;
        lodash.isRegExp = isRegExp;
        lodash.isSafeInteger = isSafeInteger;
        lodash.isSet = isSet;
        lodash.isString = isString;
        lodash.isSymbol = isSymbol;
        lodash.isTypedArray = isTypedArray;
        lodash.isUndefined = isUndefined;
        lodash.isWeakMap = isWeakMap;
        lodash.isWeakSet = isWeakSet;
        lodash.join = join;
        lodash.kebabCase = kebabCase;
        lodash.last = last;
        lodash.lastIndexOf = lastIndexOf;
        lodash.lowerCase = lowerCase;
        lodash.lowerFirst = lowerFirst;
        lodash.lt = lt;
        lodash.lte = lte;
        lodash.max = max;
        lodash.maxBy = maxBy;
        lodash.mean = mean;
        lodash.meanBy = meanBy;
        lodash.min = min;
        lodash.minBy = minBy;
        lodash.stubArray = stubArray;
        lodash.stubFalse = stubFalse;
        lodash.stubObject = stubObject;
        lodash.stubString = stubString;
        lodash.stubTrue = stubTrue;
        lodash.multiply = multiply;
        lodash.nth = nth;
        lodash.noConflict = noConflict;
        lodash.noop = noop;
        lodash.now = now;
        lodash.pad = pad;
        lodash.padEnd = padEnd;
        lodash.padStart = padStart;
        lodash.parseInt = parseInt;
        lodash.random = random;
        lodash.reduce = reduce;
        lodash.reduceRight = reduceRight;
        lodash.repeat = repeat;
        lodash.replace = replace;
        lodash.result = result;
        lodash.round = round;
        lodash.runInContext = runInContext;
        lodash.sample = sample;
        lodash.size = size;
        lodash.snakeCase = snakeCase;
        lodash.some = some;
        lodash.sortedIndex = sortedIndex;
        lodash.sortedIndexBy = sortedIndexBy;
        lodash.sortedIndexOf = sortedIndexOf;
        lodash.sortedLastIndex = sortedLastIndex;
        lodash.sortedLastIndexBy = sortedLastIndexBy;
        lodash.sortedLastIndexOf = sortedLastIndexOf;
        lodash.startCase = startCase;
        lodash.startsWith = startsWith;
        lodash.subtract = subtract;
        lodash.sum = sum;
        lodash.sumBy = sumBy;
        lodash.template = template;
        lodash.times = times;
        lodash.toFinite = toFinite;
        lodash.toInteger = toInteger;
        lodash.toLength = toLength;
        lodash.toLower = toLower;
        lodash.toNumber = toNumber;
        lodash.toSafeInteger = toSafeInteger;
        lodash.toString = toString;
        lodash.toUpper = toUpper;
        lodash.trim = trim;
        lodash.trimEnd = trimEnd;
        lodash.trimStart = trimStart;
        lodash.truncate = truncate;
        lodash.unescape = unescape;
        lodash.uniqueId = uniqueId;
        lodash.upperCase = upperCase;
        lodash.upperFirst = upperFirst;

        // Add aliases.
        lodash.each = forEach;
        lodash.eachRight = forEachRight;
        lodash.first = head;

        mixin(lodash, (function() {
          var source = {};
          baseForOwn(lodash, function(func, methodName) {
            if (!hasOwnProperty.call(lodash.prototype, methodName)) {
              source[methodName] = func;
            }
          });
          return source;
        }()), { 'chain': false });

        /*------------------------------------------------------------------------*/

        /**
         * The semantic version number.
         *
         * @static
         * @memberOf _
         * @type {string}
         */
        lodash.VERSION = VERSION;

        // Assign default placeholders.
        arrayEach(['bind', 'bindKey', 'curry', 'curryRight', 'partial', 'partialRight'], function(methodName) {
          lodash[methodName].placeholder = lodash;
        });

        // Add `LazyWrapper` methods for `_.drop` and `_.take` variants.
        arrayEach(['drop', 'take'], function(methodName, index) {
          LazyWrapper.prototype[methodName] = function(n) {
            n = n === undefined$1 ? 1 : nativeMax(toInteger(n), 0);

            var result = (this.__filtered__ && !index)
              ? new LazyWrapper(this)
              : this.clone();

            if (result.__filtered__) {
              result.__takeCount__ = nativeMin(n, result.__takeCount__);
            } else {
              result.__views__.push({
                'size': nativeMin(n, MAX_ARRAY_LENGTH),
                'type': methodName + (result.__dir__ < 0 ? 'Right' : '')
              });
            }
            return result;
          };

          LazyWrapper.prototype[methodName + 'Right'] = function(n) {
            return this.reverse()[methodName](n).reverse();
          };
        });

        // Add `LazyWrapper` methods that accept an `iteratee` value.
        arrayEach(['filter', 'map', 'takeWhile'], function(methodName, index) {
          var type = index + 1,
              isFilter = type == LAZY_FILTER_FLAG || type == LAZY_WHILE_FLAG;

          LazyWrapper.prototype[methodName] = function(iteratee) {
            var result = this.clone();
            result.__iteratees__.push({
              'iteratee': getIteratee(iteratee, 3),
              'type': type
            });
            result.__filtered__ = result.__filtered__ || isFilter;
            return result;
          };
        });

        // Add `LazyWrapper` methods for `_.head` and `_.last`.
        arrayEach(['head', 'last'], function(methodName, index) {
          var takeName = 'take' + (index ? 'Right' : '');

          LazyWrapper.prototype[methodName] = function() {
            return this[takeName](1).value()[0];
          };
        });

        // Add `LazyWrapper` methods for `_.initial` and `_.tail`.
        arrayEach(['initial', 'tail'], function(methodName, index) {
          var dropName = 'drop' + (index ? '' : 'Right');

          LazyWrapper.prototype[methodName] = function() {
            return this.__filtered__ ? new LazyWrapper(this) : this[dropName](1);
          };
        });

        LazyWrapper.prototype.compact = function() {
          return this.filter(identity);
        };

        LazyWrapper.prototype.find = function(predicate) {
          return this.filter(predicate).head();
        };

        LazyWrapper.prototype.findLast = function(predicate) {
          return this.reverse().find(predicate);
        };

        LazyWrapper.prototype.invokeMap = baseRest(function(path, args) {
          if (typeof path == 'function') {
            return new LazyWrapper(this);
          }
          return this.map(function(value) {
            return baseInvoke(value, path, args);
          });
        });

        LazyWrapper.prototype.reject = function(predicate) {
          return this.filter(negate(getIteratee(predicate)));
        };

        LazyWrapper.prototype.slice = function(start, end) {
          start = toInteger(start);

          var result = this;
          if (result.__filtered__ && (start > 0 || end < 0)) {
            return new LazyWrapper(result);
          }
          if (start < 0) {
            result = result.takeRight(-start);
          } else if (start) {
            result = result.drop(start);
          }
          if (end !== undefined$1) {
            end = toInteger(end);
            result = end < 0 ? result.dropRight(-end) : result.take(end - start);
          }
          return result;
        };

        LazyWrapper.prototype.takeRightWhile = function(predicate) {
          return this.reverse().takeWhile(predicate).reverse();
        };

        LazyWrapper.prototype.toArray = function() {
          return this.take(MAX_ARRAY_LENGTH);
        };

        // Add `LazyWrapper` methods to `lodash.prototype`.
        baseForOwn(LazyWrapper.prototype, function(func, methodName) {
          var checkIteratee = /^(?:filter|find|map|reject)|While$/.test(methodName),
              isTaker = /^(?:head|last)$/.test(methodName),
              lodashFunc = lodash[isTaker ? ('take' + (methodName == 'last' ? 'Right' : '')) : methodName],
              retUnwrapped = isTaker || /^find/.test(methodName);

          if (!lodashFunc) {
            return;
          }
          lodash.prototype[methodName] = function() {
            var value = this.__wrapped__,
                args = isTaker ? [1] : arguments,
                isLazy = value instanceof LazyWrapper,
                iteratee = args[0],
                useLazy = isLazy || isArray(value);

            var interceptor = function(value) {
              var result = lodashFunc.apply(lodash, arrayPush([value], args));
              return (isTaker && chainAll) ? result[0] : result;
            };

            if (useLazy && checkIteratee && typeof iteratee == 'function' && iteratee.length != 1) {
              // Avoid lazy use if the iteratee has a "length" value other than `1`.
              isLazy = useLazy = false;
            }
            var chainAll = this.__chain__,
                isHybrid = !!this.__actions__.length,
                isUnwrapped = retUnwrapped && !chainAll,
                onlyLazy = isLazy && !isHybrid;

            if (!retUnwrapped && useLazy) {
              value = onlyLazy ? value : new LazyWrapper(this);
              var result = func.apply(value, args);
              result.__actions__.push({ 'func': thru, 'args': [interceptor], 'thisArg': undefined$1 });
              return new LodashWrapper(result, chainAll);
            }
            if (isUnwrapped && onlyLazy) {
              return func.apply(this, args);
            }
            result = this.thru(interceptor);
            return isUnwrapped ? (isTaker ? result.value()[0] : result.value()) : result;
          };
        });

        // Add `Array` methods to `lodash.prototype`.
        arrayEach(['pop', 'push', 'shift', 'sort', 'splice', 'unshift'], function(methodName) {
          var func = arrayProto[methodName],
              chainName = /^(?:push|sort|unshift)$/.test(methodName) ? 'tap' : 'thru',
              retUnwrapped = /^(?:pop|shift)$/.test(methodName);

          lodash.prototype[methodName] = function() {
            var args = arguments;
            if (retUnwrapped && !this.__chain__) {
              var value = this.value();
              return func.apply(isArray(value) ? value : [], args);
            }
            return this[chainName](function(value) {
              return func.apply(isArray(value) ? value : [], args);
            });
          };
        });

        // Map minified method names to their real names.
        baseForOwn(LazyWrapper.prototype, function(func, methodName) {
          var lodashFunc = lodash[methodName];
          if (lodashFunc) {
            var key = lodashFunc.name + '';
            if (!hasOwnProperty.call(realNames, key)) {
              realNames[key] = [];
            }
            realNames[key].push({ 'name': methodName, 'func': lodashFunc });
          }
        });

        realNames[createHybrid(undefined$1, WRAP_BIND_KEY_FLAG).name] = [{
          'name': 'wrapper',
          'func': undefined$1
        }];

        // Add methods to `LazyWrapper`.
        LazyWrapper.prototype.clone = lazyClone;
        LazyWrapper.prototype.reverse = lazyReverse;
        LazyWrapper.prototype.value = lazyValue;

        // Add chain sequence methods to the `lodash` wrapper.
        lodash.prototype.at = wrapperAt;
        lodash.prototype.chain = wrapperChain;
        lodash.prototype.commit = wrapperCommit;
        lodash.prototype.next = wrapperNext;
        lodash.prototype.plant = wrapperPlant;
        lodash.prototype.reverse = wrapperReverse;
        lodash.prototype.toJSON = lodash.prototype.valueOf = lodash.prototype.value = wrapperValue;

        // Add lazy aliases.
        lodash.prototype.first = lodash.prototype.head;

        if (symIterator) {
          lodash.prototype[symIterator] = wrapperToIterator;
        }
        return lodash;
      });

      /*--------------------------------------------------------------------------*/

      // Export lodash.
      var _ = runInContext();

      // Some AMD build optimizers, like r.js, check for condition patterns like:
      if (freeModule) {
        // Export for Node.js.
        (freeModule.exports = _)._ = _;
        // Export for CommonJS support.
        freeExports._ = _;
      }
      else {
        // Export to the global object.
        root._ = _;
      }
    }.call(commonjsGlobal));
    });

    /* src/components/monitor/health/NodeHealth.svelte generated by Svelte v3.44.2 */
    const file$g = "src/components/monitor/health/NodeHealth.svelte";

    function get_each_context$7(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[2] = list[i];
    	return child_ctx;
    }

    // (145:2) {:else}
    function create_else_block$7(ctx) {
    	let p;

    	const block = {
    		c: function create() {
    			p = element("p");
    			p.textContent = "loading...";
    			add_location(p, file$g, 145, 4, 4200);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, p, anchor);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(p);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block$7.name,
    		type: "else",
    		source: "(145:2) {:else}",
    		ctx
    	});

    	return block;
    }

    // (135:2) {#if health_data}
    function create_if_block$a(ctx) {
    	let dl;
    	let current;
    	let each_value = /*allChecks*/ ctx[1];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$7(get_each_context$7(ctx, each_value, i));
    	}

    	const out = i => transition_out(each_blocks[i], 1, 1, () => {
    		each_blocks[i] = null;
    	});

    	const block = {
    		c: function create() {
    			dl = element("dl");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr_dev(dl, "class", "uk-description-list");
    			add_location(dl, file$g, 135, 4, 3981);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, dl, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(dl, null);
    			}

    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*allChecks*/ 2) {
    				each_value = /*allChecks*/ ctx[1];
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$7(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    						transition_in(each_blocks[i], 1);
    					} else {
    						each_blocks[i] = create_each_block$7(child_ctx);
    						each_blocks[i].c();
    						transition_in(each_blocks[i], 1);
    						each_blocks[i].m(dl, null);
    					}
    				}

    				group_outros();

    				for (i = each_value.length; i < each_blocks.length; i += 1) {
    					out(i);
    				}

    				check_outros();
    			}
    		},
    		i: function intro(local) {
    			if (current) return;

    			for (let i = 0; i < each_value.length; i += 1) {
    				transition_in(each_blocks[i]);
    			}

    			current = true;
    		},
    		o: function outro(local) {
    			each_blocks = each_blocks.filter(Boolean);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				transition_out(each_blocks[i]);
    			}

    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(dl);
    			destroy_each(each_blocks, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$a.name,
    		type: "if",
    		source: "(135:2) {#if health_data}",
    		ctx
    	});

    	return block;
    }

    // (137:6) {#each allChecks as c}
    function create_each_block$7(ctx) {
    	let check;
    	let current;

    	check = new Check({
    			props: {
    				title: /*c*/ ctx[2].title,
    				description: /*c*/ ctx[2].description,
    				isTrue: /*c*/ ctx[2].is_true
    			},
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			create_component(check.$$.fragment);
    		},
    		m: function mount(target, anchor) {
    			mount_component(check, target, anchor);
    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			const check_changes = {};
    			if (dirty & /*allChecks*/ 2) check_changes.title = /*c*/ ctx[2].title;
    			if (dirty & /*allChecks*/ 2) check_changes.description = /*c*/ ctx[2].description;
    			if (dirty & /*allChecks*/ 2) check_changes.isTrue = /*c*/ ctx[2].is_true;
    			check.$set(check_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(check.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(check.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(check, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block$7.name,
    		type: "each",
    		source: "(137:6) {#each allChecks as c}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$g(ctx) {
    	let div;
    	let h3;
    	let t1;
    	let current_block_type_index;
    	let if_block;
    	let current;
    	const if_block_creators = [create_if_block$a, create_else_block$7];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*health_data*/ ctx[0]) return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	const block = {
    		c: function create() {
    			div = element("div");
    			h3 = element("h3");
    			h3.textContent = "Node Health";
    			t1 = space();
    			if_block.c();
    			attr_dev(h3, "class", "uk-card-title uk-text-center uk-text-uppercase uk-text-muted");
    			add_location(h3, file$g, 131, 2, 3859);
    			attr_dev(div, "class", "uk-card uk-card-default uk-card-body uk-margin-bottom");
    			add_location(div, file$g, 130, 0, 3789);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, h3);
    			append_dev(div, t1);
    			if_blocks[current_block_type_index].m(div, null);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block = if_blocks[current_block_type_index];

    				if (!if_block) {
    					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block.c();
    				} else {
    					if_block.p(ctx, dirty);
    				}

    				transition_in(if_block, 1);
    				if_block.m(div, null);
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			if_blocks[current_block_type_index].d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$g.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$g($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('NodeHealth', slots, []);
    	let { health_data } = $$props;

    	let allChecks = [
    		{
    			id: "config",
    			title: "Node configured",
    			description: "operator files created",
    			is_true: false
    		},
    		{
    			id: "restore",
    			title: "DB boostrapped",
    			description: "db successfully initialized",
    			is_true: false
    		},
    		{
    			id: "account",
    			title: "Account exists",
    			description: "owner account created on chain",
    			is_true: false
    		},
    		{
    			id: "node",
    			title: "Node is running",
    			description: "process `libra-node` has started",
    			is_true: false
    		},
    		{
    			id: "sync",
    			title: "Node is synced",
    			description: "node is up to date with upstream",
    			is_true: false
    		},
    		{
    			id: "set",
    			title: "In validator set",
    			description: "owner account is in the validator set",
    			is_true: false
    		},
    		{
    			id: "tower",
    			title: "Tower",
    			description: "process `tower` has started",
    			is_true: false
    		},
    		{
    			id: "correct_mode",
    			title: "Mode",
    			description: "node running in mode: ",
    			is_true: false
    		},
    		{
    			id: "has_autopay",
    			title: "Autopay",
    			description: "autopay instructions are set up",
    			is_true: false
    		},
    		{
    			id: "has_operator_set",
    			title: "Operator Account",
    			description: "operator account is not set",
    			is_true: false
    		},
    		{
    			id: "has_operator_positive_balance",
    			title: "Operator Balance",
    			description: "operator balance is not greater than zero",
    			is_true: false
    		}
    	];

    	const writable_props = ['health_data'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<NodeHealth> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ('health_data' in $$props) $$invalidate(0, health_data = $$props.health_data);
    	};

    	$$self.$capture_state = () => ({ Check, map: lodash.map, health_data, allChecks });

    	$$self.$inject_state = $$props => {
    		if ('health_data' in $$props) $$invalidate(0, health_data = $$props.health_data);
    		if ('allChecks' in $$props) $$invalidate(1, allChecks = $$props.allChecks);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*health_data, allChecks*/ 3) {
    			if (health_data) {
    				$$invalidate(1, allChecks = lodash.map(allChecks, i => {
    					if (i.id === "config") {
    						i.is_true = health_data.configs_exist;
    					}

    					if (i.id === "account") {
    						i.is_true = health_data.account_created;
    					}

    					if (i.id === "restore") {
    						i.is_true = health_data.db_restored;
    					}

    					if (i.id === "node") {
    						i.is_true = health_data.node_running;
    					}

    					if (i.id === "sync") {
    						i.is_true = health_data.is_synced;
    					}

    					if (i.id === "set") {
    						i.is_true = health_data.validator_set;
    					}

    					if (i.id === "tower") {
    						i.is_true = health_data.miner_running;

    						i.description = i.is_true
    						? "process `tower` has started"
    						: "process `tower` is not running";
    					}

    					if (i.id === "correct_mode") {
    						i.is_true = false;

    						if (health_data.validator_set) {
    							i.is_true = health_data.node_mode == "Validator";
    						} else {
    							i.is_true = health_data.node_mode != "Validator";
    						}

    						i.description = ("node running in mode: ").concat(health_data.node_mode);
    					}

    					if (i.id === "has_operator_set") {
    						i.is_true = health_data.has_operator_set;

    						i.description = i.is_true
    						? "operator account is set"
    						: "operator account is not set";
    					}

    					if (i.id === "has_operator_positive_balance") {
    						i.is_true = health_data.has_operator_positive_balance;

    						i.description = i.is_true
    						? "operator balance is positive"
    						: "operator balance is not positive";
    					}

    					if (i.id === "has_autopay") {
    						i.is_true = health_data.has_autopay;

    						i.description = i.is_true
    						? "autopay instructions are set up"
    						: "autopay instructions not found";
    					}

    					return i;
    				}));
    			}
    		}
    	};

    	return [health_data, allChecks];
    }

    class NodeHealth extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$g, create_fragment$g, safe_not_equal, { health_data: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "NodeHealth",
    			options,
    			id: create_fragment$g.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*health_data*/ ctx[0] === undefined && !('health_data' in props)) {
    			console.warn("<NodeHealth> was created without expected prop 'health_data'");
    		}
    	}

    	get health_data() {
    		throw new Error("<NodeHealth>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set health_data(value) {
    		throw new Error("<NodeHealth>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/monitor/chain/Info.svelte generated by Svelte v3.44.2 */

    const file$f = "src/components/monitor/chain/Info.svelte";

    // (25:2) {:else}
    function create_else_block$6(ctx) {
    	let p;

    	const block = {
    		c: function create() {
    			p = element("p");
    			p.textContent = "loading...";
    			add_location(p, file$f, 25, 4, 697);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, p, anchor);
    		},
    		p: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(p);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block$6.name,
    		type: "else",
    		source: "(25:2) {:else}",
    		ctx
    	});

    	return block;
    }

    // (8:2) {#if chain}
    function create_if_block$9(ctx) {
    	let table;
    	let tbody;
    	let tr0;
    	let td0;
    	let t1;
    	let td1;
    	let t2_value = /*chain*/ ctx[0].epoch + "";
    	let t2;
    	let t3;
    	let tr1;
    	let td2;
    	let t5;
    	let td3;
    	let t6_value = /*chain*/ ctx[0].height.toLocaleString("en-ES") + "";
    	let t6;
    	let t7;
    	let tr2;
    	let td4;
    	let t9;
    	let td5;
    	let t10_value = /*chain*/ ctx[0].waypoint + "";
    	let t10;

    	const block = {
    		c: function create() {
    			table = element("table");
    			tbody = element("tbody");
    			tr0 = element("tr");
    			td0 = element("td");
    			td0.textContent = "Epoch";
    			t1 = space();
    			td1 = element("td");
    			t2 = text(t2_value);
    			t3 = space();
    			tr1 = element("tr");
    			td2 = element("td");
    			td2.textContent = "Height";
    			t5 = space();
    			td3 = element("td");
    			t6 = text(t6_value);
    			t7 = space();
    			tr2 = element("tr");
    			td4 = element("td");
    			td4.textContent = "Waypoint";
    			t9 = space();
    			td5 = element("td");
    			t10 = text(t10_value);
    			attr_dev(td0, "class", "uk-text-uppercase");
    			add_location(td0, file$f, 11, 10, 289);
    			add_location(td1, file$f, 12, 10, 340);
    			add_location(tr0, file$f, 10, 8, 274);
    			attr_dev(td2, "class", "uk-text-uppercase");
    			add_location(td2, file$f, 15, 10, 402);
    			add_location(td3, file$f, 16, 10, 454);
    			add_location(tr1, file$f, 14, 8, 387);
    			attr_dev(td4, "class", "uk-text-uppercase");
    			add_location(td4, file$f, 19, 10, 539);
    			attr_dev(td5, "class", "uk-text-break");
    			add_location(td5, file$f, 20, 10, 593);
    			add_location(tr2, file$f, 18, 8, 524);
    			add_location(tbody, file$f, 9, 6, 258);
    			attr_dev(table, "class", "uk-table");
    			add_location(table, file$f, 8, 4, 227);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, table, anchor);
    			append_dev(table, tbody);
    			append_dev(tbody, tr0);
    			append_dev(tr0, td0);
    			append_dev(tr0, t1);
    			append_dev(tr0, td1);
    			append_dev(td1, t2);
    			append_dev(tbody, t3);
    			append_dev(tbody, tr1);
    			append_dev(tr1, td2);
    			append_dev(tr1, t5);
    			append_dev(tr1, td3);
    			append_dev(td3, t6);
    			append_dev(tbody, t7);
    			append_dev(tbody, tr2);
    			append_dev(tr2, td4);
    			append_dev(tr2, t9);
    			append_dev(tr2, td5);
    			append_dev(td5, t10);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*chain*/ 1 && t2_value !== (t2_value = /*chain*/ ctx[0].epoch + "")) set_data_dev(t2, t2_value);
    			if (dirty & /*chain*/ 1 && t6_value !== (t6_value = /*chain*/ ctx[0].height.toLocaleString("en-ES") + "")) set_data_dev(t6, t6_value);
    			if (dirty & /*chain*/ 1 && t10_value !== (t10_value = /*chain*/ ctx[0].waypoint + "")) set_data_dev(t10, t10_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(table);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$9.name,
    		type: "if",
    		source: "(8:2) {#if chain}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$f(ctx) {
    	let div;
    	let h3;
    	let t1;

    	function select_block_type(ctx, dirty) {
    		if (/*chain*/ ctx[0]) return create_if_block$9;
    		return create_else_block$6;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block = current_block_type(ctx);

    	const block = {
    		c: function create() {
    			div = element("div");
    			h3 = element("h3");
    			h3.textContent = "Chain";
    			t1 = space();
    			if_block.c();
    			attr_dev(h3, "class", "uk-card-title uk-text-center uk-text-uppercase uk-text-muted");
    			add_location(h3, file$f, 4, 2, 117);
    			attr_dev(div, "class", "uk-card uk-card-default uk-card-body uk-margin-bottom");
    			add_location(div, file$f, 3, 0, 47);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, h3);
    			append_dev(div, t1);
    			if_block.m(div, null);
    		},
    		p: function update(ctx, [dirty]) {
    			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(div, null);
    				}
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			if_block.d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$f.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$f($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Info', slots, []);
    	let { chain } = $$props;
    	const writable_props = ['chain'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Info> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ('chain' in $$props) $$invalidate(0, chain = $$props.chain);
    	};

    	$$self.$capture_state = () => ({ chain });

    	$$self.$inject_state = $$props => {
    		if ('chain' in $$props) $$invalidate(0, chain = $$props.chain);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [chain];
    }

    class Info extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$f, create_fragment$f, safe_not_equal, { chain: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Info",
    			options,
    			id: create_fragment$f.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*chain*/ ctx[0] === undefined && !('chain' in props)) {
    			console.warn("<Info> was created without expected prop 'chain'");
    		}
    	}

    	get chain() {
    		throw new Error("<Info>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set chain(value) {
    		throw new Error("<Info>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/monitor/account/Account.svelte generated by Svelte v3.44.2 */
    const file$e = "src/components/monitor/account/Account.svelte";

    // (39:2) {:else}
    function create_else_block$5(ctx) {
    	let p;

    	const block = {
    		c: function create() {
    			p = element("p");
    			p.textContent = "loading...";
    			add_location(p, file$e, 39, 4, 1165);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, p, anchor);
    		},
    		p: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(p);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block$5.name,
    		type: "else",
    		source: "(39:2) {:else}",
    		ctx
    	});

    	return block;
    }

    // (16:2) {#if account}
    function create_if_block$8(ctx) {
    	let table;
    	let thead;
    	let tr0;
    	let th0;
    	let t1;
    	let th1;
    	let t3;
    	let th2;
    	let t5;
    	let tbody;
    	let tr1;
    	let td0;
    	let t7;
    	let td1;
    	let t8_value = /*account*/ ctx[0].address + "";
    	let t8;
    	let t9;
    	let td2;
    	let t10_value = formatBalance$1(/*account*/ ctx[0].balance) + "";
    	let t10;
    	let t11;
    	let if_block = /*account*/ ctx[0].operator_account != null && create_if_block_1$6(ctx);

    	const block = {
    		c: function create() {
    			table = element("table");
    			thead = element("thead");
    			tr0 = element("tr");
    			th0 = element("th");
    			th0.textContent = "Type";
    			t1 = space();
    			th1 = element("th");
    			th1.textContent = "Address";
    			t3 = space();
    			th2 = element("th");
    			th2.textContent = "Balance";
    			t5 = space();
    			tbody = element("tbody");
    			tr1 = element("tr");
    			td0 = element("td");
    			td0.textContent = "validator";
    			t7 = space();
    			td1 = element("td");
    			t8 = text(t8_value);
    			t9 = space();
    			td2 = element("td");
    			t10 = text(t10_value);
    			t11 = space();
    			if (if_block) if_block.c();
    			add_location(th0, file$e, 19, 10, 503);
    			add_location(th1, file$e, 20, 10, 527);
    			add_location(th2, file$e, 21, 10, 554);
    			add_location(tr0, file$e, 18, 8, 488);
    			add_location(thead, file$e, 17, 6, 472);
    			attr_dev(td0, "class", "uk-text-uppercase");
    			add_location(td0, file$e, 25, 10, 622);
    			attr_dev(td1, "class", "uk-text-truncate");
    			add_location(td1, file$e, 26, 10, 677);
    			attr_dev(td2, "class", "uk-text-right");
    			add_location(td2, file$e, 27, 10, 739);
    			add_location(tr1, file$e, 24, 8, 607);
    			add_location(tbody, file$e, 23, 6, 591);
    			attr_dev(table, "class", "uk-table");
    			add_location(table, file$e, 16, 4, 441);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, table, anchor);
    			append_dev(table, thead);
    			append_dev(thead, tr0);
    			append_dev(tr0, th0);
    			append_dev(tr0, t1);
    			append_dev(tr0, th1);
    			append_dev(tr0, t3);
    			append_dev(tr0, th2);
    			append_dev(thead, t5);
    			append_dev(table, tbody);
    			append_dev(tbody, tr1);
    			append_dev(tr1, td0);
    			append_dev(tr1, t7);
    			append_dev(tr1, td1);
    			append_dev(td1, t8);
    			append_dev(tr1, t9);
    			append_dev(tr1, td2);
    			append_dev(td2, t10);
    			append_dev(tbody, t11);
    			if (if_block) if_block.m(tbody, null);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*account*/ 1 && t8_value !== (t8_value = /*account*/ ctx[0].address + "")) set_data_dev(t8, t8_value);
    			if (dirty & /*account*/ 1 && t10_value !== (t10_value = formatBalance$1(/*account*/ ctx[0].balance) + "")) set_data_dev(t10, t10_value);

    			if (/*account*/ ctx[0].operator_account != null) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_1$6(ctx);
    					if_block.c();
    					if_block.m(tbody, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(table);
    			if (if_block) if_block.d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$8.name,
    		type: "if",
    		source: "(16:2) {#if account}",
    		ctx
    	});

    	return block;
    }

    // (30:8) {#if account.operator_account != null}
    function create_if_block_1$6(ctx) {
    	let tr;
    	let td0;
    	let t1;
    	let td1;
    	let t2_value = /*account*/ ctx[0].operator_account + "";
    	let t2;
    	let t3;
    	let td2;
    	let t4_value = formatBalance$1(/*account*/ ctx[0].operator_balance) + "";
    	let t4;

    	const block = {
    		c: function create() {
    			tr = element("tr");
    			td0 = element("td");
    			td0.textContent = "operator";
    			t1 = space();
    			td1 = element("td");
    			t2 = text(t2_value);
    			t3 = space();
    			td2 = element("td");
    			t4 = text(t4_value);
    			attr_dev(td0, "class", "uk-text-uppercase");
    			add_location(td0, file$e, 31, 12, 891);
    			attr_dev(td1, "class", "uk-text-truncate");
    			add_location(td1, file$e, 32, 12, 947);
    			attr_dev(td2, "class", "uk-text-right");
    			add_location(td2, file$e, 33, 12, 1020);
    			add_location(tr, file$e, 30, 10, 874);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, tr, anchor);
    			append_dev(tr, td0);
    			append_dev(tr, t1);
    			append_dev(tr, td1);
    			append_dev(td1, t2);
    			append_dev(tr, t3);
    			append_dev(tr, td2);
    			append_dev(td2, t4);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*account*/ 1 && t2_value !== (t2_value = /*account*/ ctx[0].operator_account + "")) set_data_dev(t2, t2_value);
    			if (dirty & /*account*/ 1 && t4_value !== (t4_value = formatBalance$1(/*account*/ ctx[0].operator_balance) + "")) set_data_dev(t4, t4_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(tr);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_1$6.name,
    		type: "if",
    		source: "(30:8) {#if account.operator_account != null}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$e(ctx) {
    	let div;
    	let h3;
    	let t1;

    	function select_block_type(ctx, dirty) {
    		if (/*account*/ ctx[0]) return create_if_block$8;
    		return create_else_block$5;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block = current_block_type(ctx);

    	const block = {
    		c: function create() {
    			div = element("div");
    			h3 = element("h3");
    			h3.textContent = "Accounts";
    			t1 = space();
    			if_block.c();
    			attr_dev(h3, "class", "uk-card-title uk-text-center uk-text-uppercase uk-text-muted uk-text-large");
    			add_location(h3, file$e, 11, 2, 311);
    			attr_dev(div, "class", "uk-card uk-card-default uk-card-body uk-margin-bottom");
    			add_location(div, file$e, 10, 0, 241);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, h3);
    			append_dev(div, t1);
    			if_block.m(div, null);
    		},
    		p: function update(ctx, [dirty]) {
    			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(div, null);
    				}
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			if_block.d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$e.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function formatBalance$1(balance) {
    	return balance.toLocaleString('en-ES', {
    		minimumFractionDigits: 2,
    		maximumFractionDigits: 2
    	});
    }

    function instance$e($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Account', slots, []);
    	let { account } = $$props;
    	const writable_props = ['account'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Account> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ('account' in $$props) $$invalidate(0, account = $$props.account);
    	};

    	$$self.$capture_state = () => ({ account, formatBalance: formatBalance$1 });

    	$$self.$inject_state = $$props => {
    		if ('account' in $$props) $$invalidate(0, account = $$props.account);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [account];
    }

    class Account extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$e, create_fragment$e, safe_not_equal, { account: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Account",
    			options,
    			id: create_fragment$e.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*account*/ ctx[0] === undefined && !('account' in props)) {
    			console.warn("<Account> was created without expected prop 'account'");
    		}
    	}

    	get account() {
    		throw new Error("<Account>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set account(value) {
    		throw new Error("<Account>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/monitor/Dash.svelte generated by Svelte v3.44.2 */
    const file$d = "src/components/monitor/Dash.svelte";

    function create_fragment$d(ctx) {
    	let main;
    	let div3;
    	let div0;
    	let nodehealth;
    	let t0;
    	let div1;
    	let info;
    	let t1;
    	let div2;
    	let account;
    	let current;

    	nodehealth = new NodeHealth({
    			props: { health_data: /*data*/ ctx[0].items },
    			$$inline: true
    		});

    	info = new Info({
    			props: { chain: /*data*/ ctx[0].chain_view },
    			$$inline: true
    		});

    	account = new Account({
    			props: { account: /*data*/ ctx[0].account_view },
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			main = element("main");
    			div3 = element("div");
    			div0 = element("div");
    			create_component(nodehealth.$$.fragment);
    			t0 = space();
    			div1 = element("div");
    			create_component(info.$$.fragment);
    			t1 = space();
    			div2 = element("div");
    			create_component(account.$$.fragment);
    			attr_dev(div0, "class", "uk-width-1-3@m");
    			add_location(div0, file$d, 10, 4, 250);
    			attr_dev(div1, "class", "uk-width-1-3@m");
    			add_location(div1, file$d, 13, 4, 339);
    			attr_dev(div2, "class", "uk-width-1-3@m");
    			add_location(div2, file$d, 16, 4, 421);
    			attr_dev(div3, "class", "uk-grid-match uk-grid-small");
    			attr_dev(div3, "uk-grid", "");
    			add_location(div3, file$d, 9, 2, 196);
    			add_location(main, file$d, 8, 0, 187);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			append_dev(main, div3);
    			append_dev(div3, div0);
    			mount_component(nodehealth, div0, null);
    			append_dev(div3, t0);
    			append_dev(div3, div1);
    			mount_component(info, div1, null);
    			append_dev(div3, t1);
    			append_dev(div3, div2);
    			mount_component(account, div2, null);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			const nodehealth_changes = {};
    			if (dirty & /*data*/ 1) nodehealth_changes.health_data = /*data*/ ctx[0].items;
    			nodehealth.$set(nodehealth_changes);
    			const info_changes = {};
    			if (dirty & /*data*/ 1) info_changes.chain = /*data*/ ctx[0].chain_view;
    			info.$set(info_changes);
    			const account_changes = {};
    			if (dirty & /*data*/ 1) account_changes.account = /*data*/ ctx[0].account_view;
    			account.$set(account_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(nodehealth.$$.fragment, local);
    			transition_in(info.$$.fragment, local);
    			transition_in(account.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(nodehealth.$$.fragment, local);
    			transition_out(info.$$.fragment, local);
    			transition_out(account.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    			destroy_component(nodehealth);
    			destroy_component(info);
    			destroy_component(account);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$d.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$d($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Dash', slots, []);
    	let { data } = $$props;
    	const writable_props = ['data'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Dash> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ('data' in $$props) $$invalidate(0, data = $$props.data);
    	};

    	$$self.$capture_state = () => ({ NodeHealth, Info, Account, data });

    	$$self.$inject_state = $$props => {
    		if ('data' in $$props) $$invalidate(0, data = $$props.data);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [data];
    }

    class Dash extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$d, create_fragment$d, safe_not_equal, { data: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Dash",
    			options,
    			id: create_fragment$d.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*data*/ ctx[0] === undefined && !('data' in props)) {
    			console.warn("<Dash> was created without expected prop 'data'");
    		}
    	}

    	get data() {
    		throw new Error("<Dash>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set data(value) {
    		throw new Error("<Dash>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/address/AddressNoteTip.svelte generated by Svelte v3.44.2 */

    const file$c = "src/components/address/AddressNoteTip.svelte";

    function create_fragment$c(ctx) {
    	let a;
    	let span;

    	const block = {
    		c: function create() {
    			a = element("a");
    			span = element("span");
    			attr_dev(span, "uk-icon", "icon: info");
    			add_location(span, file$c, 1, 2, 140);
    			attr_dev(a, "target", "_blank");
    			attr_dev(a, "href", "https://github.com/OLSF/libra/blob/main/ol/documentation/node-ops/validators/web_monitor_account_dictionary.md");
    			add_location(a, file$c, 0, 0, 0);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, a, anchor);
    			append_dev(a, span);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(a);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$c.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$c($$self, $$props) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('AddressNoteTip', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<AddressNoteTip> was created with unknown prop '${key}'`);
    	});

    	return [];
    }

    class AddressNoteTip extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$c, create_fragment$c, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "AddressNoteTip",
    			options,
    			id: create_fragment$c.name
    		});
    	}
    }

    /* src/components/validators/Network.svelte generated by Svelte v3.44.2 */

    const { Object: Object_1$1 } = globals;
    const file$b = "src/components/validators/Network.svelte";

    function get_each_context$6(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[4] = list[i];
    	return child_ctx;
    }

    function get_each_context_1$3(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[7] = list[i];
    	return child_ctx;
    }

    function get_each_context_2(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[7] = list[i];
    	return child_ctx;
    }

    // (17:8) {#if has_notes}
    function create_if_block_1$5(ctx) {
    	let th;

    	const block = {
    		c: function create() {
    			th = element("th");
    			th.textContent = "note";
    			attr_dev(th, "class", "uk-text-center");
    			add_location(th, file$b, 17, 10, 513);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, th, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(th);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_1$5.name,
    		type: "if",
    		source: "(17:8) {#if has_notes}",
    		ctx
    	});

    	return block;
    }

    // (23:8) {#each ports as port}
    function create_each_block_2(ctx) {
    	let th;
    	let t0;
    	let t1_value = /*port*/ ctx[7] + "";
    	let t1;

    	const block = {
    		c: function create() {
    			th = element("th");
    			t0 = text("val port ");
    			t1 = text(t1_value);
    			attr_dev(th, "class", "uk-text-center");
    			add_location(th, file$b, 23, 10, 742);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, th, anchor);
    			append_dev(th, t0);
    			append_dev(th, t1);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*ports*/ 2 && t1_value !== (t1_value = /*port*/ ctx[7] + "")) set_data_dev(t1, t1_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(th);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block_2.name,
    		type: "each",
    		source: "(23:8) {#each ports as port}",
    		ctx
    	});

    	return block;
    }

    // (31:10) {#if has_notes}
    function create_if_block$7(ctx) {
    	let td;
    	let t_value = /*val*/ ctx[4].note + "";
    	let t;

    	const block = {
    		c: function create() {
    			td = element("td");
    			t = text(t_value);
    			attr_dev(td, "class", "uk-text-center");
    			add_location(td, file$b, 31, 12, 919);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, td, anchor);
    			append_dev(td, t);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*set*/ 1 && t_value !== (t_value = /*val*/ ctx[4].note + "")) set_data_dev(t, t_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(td);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$7.name,
    		type: "if",
    		source: "(31:10) {#if has_notes}",
    		ctx
    	});

    	return block;
    }

    // (38:10) {#each ports as port}
    function create_each_block_1$3(ctx) {
    	let td;
    	let span;
    	let span_uk_icon_value;
    	let span_class_value;

    	const block = {
    		c: function create() {
    			td = element("td");
    			span = element("span");

    			attr_dev(span, "uk-icon", span_uk_icon_value = "icon: " + (/*val*/ ctx[4].ports_status[/*port*/ ctx[7]]
    			? "check"
    			: "close"));

    			attr_dev(span, "class", span_class_value = /*val*/ ctx[4].ports_status[/*port*/ ctx[7]]
    			? "uk-text-success"
    			: "uk-text-danger");

    			add_location(span, file$b, 39, 14, 1289);
    			attr_dev(td, "class", "uk-text-center");
    			add_location(td, file$b, 38, 12, 1247);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, td, anchor);
    			append_dev(td, span);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*set, ports*/ 3 && span_uk_icon_value !== (span_uk_icon_value = "icon: " + (/*val*/ ctx[4].ports_status[/*port*/ ctx[7]]
    			? "check"
    			: "close"))) {
    				attr_dev(span, "uk-icon", span_uk_icon_value);
    			}

    			if (dirty & /*set, ports*/ 3 && span_class_value !== (span_class_value = /*val*/ ctx[4].ports_status[/*port*/ ctx[7]]
    			? "uk-text-success"
    			: "uk-text-danger")) {
    				attr_dev(span, "class", span_class_value);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(td);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block_1$3.name,
    		type: "each",
    		source: "(38:10) {#each ports as port}",
    		ctx
    	});

    	return block;
    }

    // (29:6) {#each set as val}
    function create_each_block$6(ctx) {
    	let tr;
    	let t0;
    	let td0;
    	let t1_value = /*val*/ ctx[4].account_address + "";
    	let t1;
    	let t2;
    	let td1;
    	let t3_value = /*val*/ ctx[4].account_address + "";
    	let t3;
    	let t4;
    	let td2;
    	let t5_value = /*val*/ ctx[4].validator_ip + "";
    	let t5;
    	let t6;
    	let td3;
    	let t7_value = /*val*/ ctx[4].vfn_ip + "";
    	let t7;
    	let t8;
    	let t9;
    	let if_block = /*has_notes*/ ctx[2] && create_if_block$7(ctx);
    	let each_value_1 = /*ports*/ ctx[1];
    	validate_each_argument(each_value_1);
    	let each_blocks = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks[i] = create_each_block_1$3(get_each_context_1$3(ctx, each_value_1, i));
    	}

    	const block = {
    		c: function create() {
    			tr = element("tr");
    			if (if_block) if_block.c();
    			t0 = space();
    			td0 = element("td");
    			t1 = text(t1_value);
    			t2 = space();
    			td1 = element("td");
    			t3 = text(t3_value);
    			t4 = space();
    			td2 = element("td");
    			t5 = text(t5_value);
    			t6 = space();
    			td3 = element("td");
    			t7 = text(t7_value);
    			t8 = space();

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t9 = space();
    			attr_dev(td0, "class", "uk-visible@s uk-text-center");
    			add_location(td0, file$b, 33, 10, 988);
    			attr_dev(td1, "class", "uk-hidden@s uk-text-truncate");
    			add_location(td1, file$b, 34, 10, 1065);
    			add_location(td2, file$b, 35, 10, 1143);
    			add_location(td3, file$b, 36, 10, 1181);
    			add_location(tr, file$b, 29, 8, 876);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, tr, anchor);
    			if (if_block) if_block.m(tr, null);
    			append_dev(tr, t0);
    			append_dev(tr, td0);
    			append_dev(td0, t1);
    			append_dev(tr, t2);
    			append_dev(tr, td1);
    			append_dev(td1, t3);
    			append_dev(tr, t4);
    			append_dev(tr, td2);
    			append_dev(td2, t5);
    			append_dev(tr, t6);
    			append_dev(tr, td3);
    			append_dev(td3, t7);
    			append_dev(tr, t8);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(tr, null);
    			}

    			append_dev(tr, t9);
    		},
    		p: function update(ctx, dirty) {
    			if (/*has_notes*/ ctx[2]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block$7(ctx);
    					if_block.c();
    					if_block.m(tr, t0);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (dirty & /*set*/ 1 && t1_value !== (t1_value = /*val*/ ctx[4].account_address + "")) set_data_dev(t1, t1_value);
    			if (dirty & /*set*/ 1 && t3_value !== (t3_value = /*val*/ ctx[4].account_address + "")) set_data_dev(t3, t3_value);
    			if (dirty & /*set*/ 1 && t5_value !== (t5_value = /*val*/ ctx[4].validator_ip + "")) set_data_dev(t5, t5_value);
    			if (dirty & /*set*/ 1 && t7_value !== (t7_value = /*val*/ ctx[4].vfn_ip + "")) set_data_dev(t7, t7_value);

    			if (dirty & /*set, ports*/ 3) {
    				each_value_1 = /*ports*/ ctx[1];
    				validate_each_argument(each_value_1);
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1$3(ctx, each_value_1, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block_1$3(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(tr, t9);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_1.length;
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(tr);
    			if (if_block) if_block.d();
    			destroy_each(each_blocks, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block$6.name,
    		type: "each",
    		source: "(29:6) {#each set as val}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$b(ctx) {
    	let main;
    	let table;
    	let thead;
    	let tr;
    	let t0;
    	let th0;
    	let t2;
    	let th1;
    	let t4;
    	let th2;
    	let t6;
    	let t7;
    	let tbody;
    	let if_block = /*has_notes*/ ctx[2] && create_if_block_1$5(ctx);
    	let each_value_2 = /*ports*/ ctx[1];
    	validate_each_argument(each_value_2);
    	let each_blocks_1 = [];

    	for (let i = 0; i < each_value_2.length; i += 1) {
    		each_blocks_1[i] = create_each_block_2(get_each_context_2(ctx, each_value_2, i));
    	}

    	let each_value = /*set*/ ctx[0];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$6(get_each_context$6(ctx, each_value, i));
    	}

    	const block = {
    		c: function create() {
    			main = element("main");
    			table = element("table");
    			thead = element("thead");
    			tr = element("tr");
    			if (if_block) if_block.c();
    			t0 = space();
    			th0 = element("th");
    			th0.textContent = "account";
    			t2 = space();
    			th1 = element("th");
    			th1.textContent = "val ip";
    			t4 = space();
    			th2 = element("th");
    			th2.textContent = "vfn ip";
    			t6 = space();

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].c();
    			}

    			t7 = space();
    			tbody = element("tbody");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr_dev(th0, "class", "uk-text-center");
    			add_location(th0, file$b, 19, 8, 572);
    			attr_dev(th1, "class", "uk-text-left");
    			add_location(th1, file$b, 20, 8, 620);
    			attr_dev(th2, "class", "uk-text-left");
    			add_location(th2, file$b, 21, 8, 665);
    			add_location(tr, file$b, 15, 6, 474);
    			add_location(thead, file$b, 14, 4, 460);
    			add_location(tbody, file$b, 27, 4, 835);
    			attr_dev(table, "class", "uk-table uk-table-hover uk-text-muted");
    			add_location(table, file$b, 13, 2, 402);
    			add_location(main, file$b, 12, 0, 393);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			append_dev(main, table);
    			append_dev(table, thead);
    			append_dev(thead, tr);
    			if (if_block) if_block.m(tr, null);
    			append_dev(tr, t0);
    			append_dev(tr, th0);
    			append_dev(tr, t2);
    			append_dev(tr, th1);
    			append_dev(tr, t4);
    			append_dev(tr, th2);
    			append_dev(tr, t6);

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].m(tr, null);
    			}

    			append_dev(table, t7);
    			append_dev(table, tbody);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(tbody, null);
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (/*has_notes*/ ctx[2]) {
    				if (if_block) ; else {
    					if_block = create_if_block_1$5(ctx);
    					if_block.c();
    					if_block.m(tr, t0);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (dirty & /*ports*/ 2) {
    				each_value_2 = /*ports*/ ctx[1];
    				validate_each_argument(each_value_2);
    				let i;

    				for (i = 0; i < each_value_2.length; i += 1) {
    					const child_ctx = get_each_context_2(ctx, each_value_2, i);

    					if (each_blocks_1[i]) {
    						each_blocks_1[i].p(child_ctx, dirty);
    					} else {
    						each_blocks_1[i] = create_each_block_2(child_ctx);
    						each_blocks_1[i].c();
    						each_blocks_1[i].m(tr, null);
    					}
    				}

    				for (; i < each_blocks_1.length; i += 1) {
    					each_blocks_1[i].d(1);
    				}

    				each_blocks_1.length = each_value_2.length;
    			}

    			if (dirty & /*ports, set, has_notes*/ 7) {
    				each_value = /*set*/ ctx[0];
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$6(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block$6(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(tbody, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    			if (if_block) if_block.d();
    			destroy_each(each_blocks_1, detaching);
    			destroy_each(each_blocks, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$b.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$b($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Network', slots, []);
    	let { data } = $$props;
    	let ports = [];
    	let set = [];
    	let has_notes = false;
    	const writable_props = ['data'];

    	Object_1$1.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Network> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ('data' in $$props) $$invalidate(3, data = $$props.data);
    	};

    	$$self.$capture_state = () => ({ data, ports, set, has_notes });

    	$$self.$inject_state = $$props => {
    		if ('data' in $$props) $$invalidate(3, data = $$props.data);
    		if ('ports' in $$props) $$invalidate(1, ports = $$props.ports);
    		if ('set' in $$props) $$invalidate(0, set = $$props.set);
    		if ('has_notes' in $$props) $$invalidate(2, has_notes = $$props.has_notes);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*data, set*/ 9) {
    			if (data.chain_view && data.chain_view.validator_view) {
    				$$invalidate(0, set = data.chain_view.validator_view.sort((a, b) => a.ports_status[6180] > b.ports_status[6180] ? -1 : 1));
    				$$invalidate(2, has_notes = set.some(e => e.note != ""));
    				$$invalidate(1, ports = set.length > 0 ? Object.keys(set[0].ports_status) : []);
    			}
    		}
    	};

    	return [set, ports, has_notes, data];
    }

    class Network extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$b, create_fragment$b, safe_not_equal, { data: 3 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Network",
    			options,
    			id: create_fragment$b.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*data*/ ctx[3] === undefined && !('data' in props)) {
    			console.warn("<Network> was created without expected prop 'data'");
    		}
    	}

    	get data() {
    		throw new Error("<Network>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set data(value) {
    		throw new Error("<Network>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/autopay/AutoPaySummary.svelte generated by Svelte v3.44.2 */

    const { Object: Object_1 } = globals;
    const file$a = "src/components/autopay/AutoPaySummary.svelte";

    function get_each_context$5(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[2] = list[i].type;
    	child_ctx[3] = list[i].total;
    	return child_ctx;
    }

    // (35:0) {#if summary}
    function create_if_block$6(ctx) {
    	let div;
    	let table;
    	let thead;
    	let tr;
    	let th0;
    	let t1;
    	let th1;
    	let t3;
    	let tbody;
    	let each_value = /*summary*/ ctx[0];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$5(get_each_context$5(ctx, each_value, i));
    	}

    	const block = {
    		c: function create() {
    			div = element("div");
    			table = element("table");
    			thead = element("thead");
    			tr = element("tr");
    			th0 = element("th");
    			th0.textContent = "type";
    			t1 = space();
    			th1 = element("th");
    			th1.textContent = "total";
    			t3 = space();
    			tbody = element("tbody");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr_dev(th0, "class", "uk-text-left");
    			add_location(th0, file$a, 39, 20, 1066);
    			attr_dev(th1, "class", "uk-text-center");
    			add_location(th1, file$a, 40, 20, 1121);
    			add_location(tr, file$a, 38, 16, 1041);
    			add_location(thead, file$a, 37, 12, 1017);
    			add_location(tbody, file$a, 43, 12, 1214);
    			attr_dev(table, "class", "uk-table");
    			add_location(table, file$a, 36, 8, 980);
    			attr_dev(div, "class", "uk-card uk-card-default uk-card-body uk-margin-bottom autopay-summary-container svelte-1js4my7");
    			add_location(div, file$a, 35, 4, 878);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, table);
    			append_dev(table, thead);
    			append_dev(thead, tr);
    			append_dev(tr, th0);
    			append_dev(tr, t1);
    			append_dev(tr, th1);
    			append_dev(table, t3);
    			append_dev(table, tbody);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(tbody, null);
    			}
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*summary*/ 1) {
    				each_value = /*summary*/ ctx[0];
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$5(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block$5(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(tbody, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			destroy_each(each_blocks, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$6.name,
    		type: "if",
    		source: "(35:0) {#if summary}",
    		ctx
    	});

    	return block;
    }

    // (45:16) {#each summary as {type, total}}
    function create_each_block$5(ctx) {
    	let tr;
    	let td0;
    	let t0_value = /*type*/ ctx[2] + "";
    	let t0;
    	let t1;
    	let td1;
    	let t2_value = /*total*/ ctx[3] + "";
    	let t2;
    	let t3;

    	const block = {
    		c: function create() {
    			tr = element("tr");
    			td0 = element("td");
    			t0 = text(t0_value);
    			t1 = space();
    			td1 = element("td");
    			t2 = text(t2_value);
    			t3 = space();
    			attr_dev(td0, "class", "uk-text-left");
    			add_location(td0, file$a, 46, 20, 1312);
    			attr_dev(td1, "class", "uk-text-right");
    			add_location(td1, file$a, 47, 20, 1369);
    			add_location(tr, file$a, 45, 16, 1287);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, tr, anchor);
    			append_dev(tr, td0);
    			append_dev(td0, t0);
    			append_dev(tr, t1);
    			append_dev(tr, td1);
    			append_dev(td1, t2);
    			append_dev(tr, t3);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*summary*/ 1 && t0_value !== (t0_value = /*type*/ ctx[2] + "")) set_data_dev(t0, t0_value);
    			if (dirty & /*summary*/ 1 && t2_value !== (t2_value = /*total*/ ctx[3] + "")) set_data_dev(t2, t2_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(tr);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block$5.name,
    		type: "each",
    		source: "(45:16) {#each summary as {type, total}}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$a(ctx) {
    	let if_block_anchor;
    	let if_block = /*summary*/ ctx[0] && create_if_block$6(ctx);

    	const block = {
    		c: function create() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			if (if_block) if_block.m(target, anchor);
    			insert_dev(target, if_block_anchor, anchor);
    		},
    		p: function update(ctx, [dirty]) {
    			if (/*summary*/ ctx[0]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block$6(ctx);
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach_dev(if_block_anchor);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$a.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$a($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('AutoPaySummary', slots, []);
    	let { payments } = $$props;

    	// TODO: move to the server side
    	let summary;

    	const writable_props = ['payments'];

    	Object_1.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<AutoPaySummary> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ('payments' in $$props) $$invalidate(1, payments = $$props.payments);
    	};

    	$$self.$capture_state = () => ({ payments, summary });

    	$$self.$inject_state = $$props => {
    		if ('payments' in $$props) $$invalidate(1, payments = $$props.payments);
    		if ('summary' in $$props) $$invalidate(0, summary = $$props.summary);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*payments, summary*/ 3) {
    			if (payments) {
    				// calc totals by type
    				let totals = {};

    				payments.forEach(each => {
    					let previous = totals[each.type_desc];
    					totals[each.type_desc] = (previous || 0) + each.amt;
    				});

    				// format summary
    				$$invalidate(0, summary = []);

    				Object.keys(totals).forEach(type => {
    					let total = type == "percent of balance" || type == "percent of change"
    					? (totals[type] / 100).toFixed(2) + "%"
    					: totals[type].toLocaleString('en-ES');

    					summary.push({ type, total });
    				});
    			}
    		}
    	};

    	return [summary, payments];
    }

    class AutoPaySummary extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$a, create_fragment$a, safe_not_equal, { payments: 1 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "AutoPaySummary",
    			options,
    			id: create_fragment$a.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*payments*/ ctx[1] === undefined && !('payments' in props)) {
    			console.warn("<AutoPaySummary> was created without expected prop 'payments'");
    		}
    	}

    	get payments() {
    		throw new Error("<AutoPaySummary>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set payments(value) {
    		throw new Error("<AutoPaySummary>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/autopay/AutoPay.svelte generated by Svelte v3.44.2 */
    const file$9 = "src/components/autopay/AutoPay.svelte";

    function get_each_context$4(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[3] = list[i].uid;
    	child_ctx[4] = list[i].note;
    	child_ctx[5] = list[i].type_desc;
    	child_ctx[6] = list[i].payee;
    	child_ctx[7] = list[i].end_epoch;
    	child_ctx[8] = list[i].amount;
    	return child_ctx;
    }

    // (15:25) {#if payments && payments.length > 0 && !has_notes}
    function create_if_block_4$2(ctx) {
    	let addressnotetip;
    	let current;
    	addressnotetip = new AddressNoteTip({ $$inline: true });

    	const block = {
    		c: function create() {
    			create_component(addressnotetip.$$.fragment);
    		},
    		m: function mount(target, anchor) {
    			mount_component(addressnotetip, target, anchor);
    			current = true;
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(addressnotetip.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(addressnotetip.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(addressnotetip, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_4$2.name,
    		type: "if",
    		source: "(15:25) {#if payments && payments.length > 0 && !has_notes}",
    		ctx
    	});

    	return block;
    }

    // (51:2) {:else}
    function create_else_block_1$4(ctx) {
    	let p;

    	const block = {
    		c: function create() {
    			p = element("p");
    			p.textContent = "loading...";
    			add_location(p, file$9, 51, 4, 1951);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, p, anchor);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(p);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block_1$4.name,
    		type: "else",
    		source: "(51:2) {:else}",
    		ctx
    	});

    	return block;
    }

    // (18:2) {#if payments}
    function create_if_block$5(ctx) {
    	let current_block_type_index;
    	let if_block;
    	let if_block_anchor;
    	let current;
    	const if_block_creators = [create_if_block_1$4, create_else_block$4];
    	const if_blocks = [];

    	function select_block_type_1(ctx, dirty) {
    		if (/*payments*/ ctx[0].length > 0) return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type_1(ctx);
    	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	const block = {
    		c: function create() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		m: function mount(target, anchor) {
    			if_blocks[current_block_type_index].m(target, anchor);
    			insert_dev(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type_1(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block = if_blocks[current_block_type_index];

    				if (!if_block) {
    					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block.c();
    				} else {
    					if_block.p(ctx, dirty);
    				}

    				transition_in(if_block, 1);
    				if_block.m(if_block_anchor.parentNode, if_block_anchor);
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if_blocks[current_block_type_index].d(detaching);
    			if (detaching) detach_dev(if_block_anchor);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$5.name,
    		type: "if",
    		source: "(18:2) {#if payments}",
    		ctx
    	});

    	return block;
    }

    // (48:4) {:else}
    function create_else_block$4(ctx) {
    	let p;

    	const block = {
    		c: function create() {
    			p = element("p");
    			p.textContent = "Your validator does not have autopay instructions.";
    			attr_dev(p, "class", "uk-text-center uk-text-warning");
    			add_location(p, file$9, 48, 6, 1830);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, p, anchor);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(p);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block$4.name,
    		type: "else",
    		source: "(48:4) {:else}",
    		ctx
    	});

    	return block;
    }

    // (19:4) {#if payments.length > 0}
    function create_if_block_1$4(ctx) {
    	let autopaysummary;
    	let t0;
    	let div;
    	let table;
    	let thead;
    	let tr;
    	let th0;
    	let t2;
    	let t3;
    	let th1;
    	let t5;
    	let th2;
    	let t7;
    	let th3;
    	let t9;
    	let th4;
    	let t11;
    	let tbody;
    	let current;

    	autopaysummary = new AutoPaySummary({
    			props: { payments: /*payments*/ ctx[0] },
    			$$inline: true
    		});

    	let if_block = /*has_notes*/ ctx[1] && create_if_block_3$3(ctx);
    	let each_value = /*payments*/ ctx[0];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$4(get_each_context$4(ctx, each_value, i));
    	}

    	const block = {
    		c: function create() {
    			create_component(autopaysummary.$$.fragment);
    			t0 = space();
    			div = element("div");
    			table = element("table");
    			thead = element("thead");
    			tr = element("tr");
    			th0 = element("th");
    			th0.textContent = "uid";
    			t2 = space();
    			if (if_block) if_block.c();
    			t3 = space();
    			th1 = element("th");
    			th1.textContent = "payee";
    			t5 = space();
    			th2 = element("th");
    			th2.textContent = "type";
    			t7 = space();
    			th3 = element("th");
    			th3.textContent = "end epoch";
    			t9 = space();
    			th4 = element("th");
    			th4.textContent = "amount";
    			t11 = space();
    			tbody = element("tbody");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr_dev(th0, "class", "uk-text-center");
    			add_location(th0, file$9, 24, 14, 806);
    			attr_dev(th1, "class", "uk-text-center");
    			add_location(th1, file$9, 26, 14, 927);
    			attr_dev(th2, "class", "uk-text-center");
    			add_location(th2, file$9, 27, 14, 979);
    			attr_dev(th3, "class", "uk-text-center");
    			add_location(th3, file$9, 28, 14, 1030);
    			attr_dev(th4, "class", "uk-text-center");
    			add_location(th4, file$9, 29, 14, 1086);
    			add_location(tr, file$9, 23, 12, 787);
    			add_location(thead, file$9, 22, 10, 767);
    			add_location(tbody, file$9, 32, 10, 1172);
    			attr_dev(table, "class", "uk-table uk-table-hover");
    			add_location(table, file$9, 21, 8, 717);
    			attr_dev(div, "class", "uk-overflow-auto");
    			add_location(div, file$9, 20, 6, 678);
    		},
    		m: function mount(target, anchor) {
    			mount_component(autopaysummary, target, anchor);
    			insert_dev(target, t0, anchor);
    			insert_dev(target, div, anchor);
    			append_dev(div, table);
    			append_dev(table, thead);
    			append_dev(thead, tr);
    			append_dev(tr, th0);
    			append_dev(tr, t2);
    			if (if_block) if_block.m(tr, null);
    			append_dev(tr, t3);
    			append_dev(tr, th1);
    			append_dev(tr, t5);
    			append_dev(tr, th2);
    			append_dev(tr, t7);
    			append_dev(tr, th3);
    			append_dev(tr, t9);
    			append_dev(tr, th4);
    			append_dev(table, t11);
    			append_dev(table, tbody);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(tbody, null);
    			}

    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			const autopaysummary_changes = {};
    			if (dirty & /*payments*/ 1) autopaysummary_changes.payments = /*payments*/ ctx[0];
    			autopaysummary.$set(autopaysummary_changes);

    			if (/*has_notes*/ ctx[1]) {
    				if (if_block) ; else {
    					if_block = create_if_block_3$3(ctx);
    					if_block.c();
    					if_block.m(tr, t3);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (dirty & /*payments, has_notes*/ 3) {
    				each_value = /*payments*/ ctx[0];
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$4(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block$4(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(tbody, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(autopaysummary.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(autopaysummary.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(autopaysummary, detaching);
    			if (detaching) detach_dev(t0);
    			if (detaching) detach_dev(div);
    			if (if_block) if_block.d();
    			destroy_each(each_blocks, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_1$4.name,
    		type: "if",
    		source: "(19:4) {#if payments.length > 0}",
    		ctx
    	});

    	return block;
    }

    // (26:14) {#if has_notes}
    function create_if_block_3$3(ctx) {
    	let th;

    	const block = {
    		c: function create() {
    			th = element("th");
    			th.textContent = "note";
    			attr_dev(th, "class", "uk-text-center");
    			add_location(th, file$9, 25, 29, 871);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, th, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(th);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_3$3.name,
    		type: "if",
    		source: "(26:14) {#if has_notes}",
    		ctx
    	});

    	return block;
    }

    // (37:16) {#if has_notes}
    function create_if_block_2$4(ctx) {
    	let td;
    	let t_value = /*note*/ ctx[4] + "";
    	let t;

    	const block = {
    		c: function create() {
    			td = element("td");
    			t = text(t_value);
    			attr_dev(td, "class", "uk-text-center");
    			add_location(td, file$9, 36, 31, 1365);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, td, anchor);
    			append_dev(td, t);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*payments*/ 1 && t_value !== (t_value = /*note*/ ctx[4] + "")) set_data_dev(t, t_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(td);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_2$4.name,
    		type: "if",
    		source: "(37:16) {#if has_notes}",
    		ctx
    	});

    	return block;
    }

    // (34:12) {#each payments as {uid, note, type_desc, payee, end_epoch, amount}}
    function create_each_block$4(ctx) {
    	let tr;
    	let td0;
    	let t0_value = /*uid*/ ctx[3] + "";
    	let t0;
    	let t1;
    	let t2;
    	let td1;
    	let t3_value = /*payee*/ ctx[6] + "";
    	let t3;
    	let t4;
    	let td2;
    	let t5_value = /*payee*/ ctx[6] + "";
    	let t5;
    	let t6;
    	let td3;
    	let t7_value = /*type_desc*/ ctx[5] + "";
    	let t7;
    	let t8;
    	let td4;
    	let t9_value = /*end_epoch*/ ctx[7] + "";
    	let t9;
    	let t10;
    	let td5;
    	let t11_value = /*amount*/ ctx[8] + "";
    	let t11;
    	let t12;
    	let if_block = /*has_notes*/ ctx[1] && create_if_block_2$4(ctx);

    	const block = {
    		c: function create() {
    			tr = element("tr");
    			td0 = element("td");
    			t0 = text(t0_value);
    			t1 = space();
    			if (if_block) if_block.c();
    			t2 = space();
    			td1 = element("td");
    			t3 = text(t3_value);
    			t4 = space();
    			td2 = element("td");
    			t5 = text(t5_value);
    			t6 = space();
    			td3 = element("td");
    			t7 = text(t7_value);
    			t8 = space();
    			td4 = element("td");
    			t9 = text(t9_value);
    			t10 = space();
    			td5 = element("td");
    			t11 = text(t11_value);
    			t12 = space();
    			attr_dev(td0, "class", "uk-text-center");
    			add_location(td0, file$9, 35, 16, 1296);
    			attr_dev(td1, "class", "uk-visible@s uk-text-center");
    			add_location(td1, file$9, 37, 16, 1425);
    			attr_dev(td2, "class", "uk-hidden@s uk-text-truncate");
    			add_location(td2, file$9, 38, 16, 1494);
    			attr_dev(td3, "class", "uk-text-center");
    			add_location(td3, file$9, 39, 16, 1564);
    			attr_dev(td4, "class", "uk-text-right");
    			add_location(td4, file$9, 40, 16, 1624);
    			attr_dev(td5, "class", "uk-text-right");
    			add_location(td5, file$9, 41, 16, 1683);
    			add_location(tr, file$9, 34, 14, 1275);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, tr, anchor);
    			append_dev(tr, td0);
    			append_dev(td0, t0);
    			append_dev(tr, t1);
    			if (if_block) if_block.m(tr, null);
    			append_dev(tr, t2);
    			append_dev(tr, td1);
    			append_dev(td1, t3);
    			append_dev(tr, t4);
    			append_dev(tr, td2);
    			append_dev(td2, t5);
    			append_dev(tr, t6);
    			append_dev(tr, td3);
    			append_dev(td3, t7);
    			append_dev(tr, t8);
    			append_dev(tr, td4);
    			append_dev(td4, t9);
    			append_dev(tr, t10);
    			append_dev(tr, td5);
    			append_dev(td5, t11);
    			append_dev(tr, t12);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*payments*/ 1 && t0_value !== (t0_value = /*uid*/ ctx[3] + "")) set_data_dev(t0, t0_value);

    			if (/*has_notes*/ ctx[1]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_2$4(ctx);
    					if_block.c();
    					if_block.m(tr, t2);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (dirty & /*payments*/ 1 && t3_value !== (t3_value = /*payee*/ ctx[6] + "")) set_data_dev(t3, t3_value);
    			if (dirty & /*payments*/ 1 && t5_value !== (t5_value = /*payee*/ ctx[6] + "")) set_data_dev(t5, t5_value);
    			if (dirty & /*payments*/ 1 && t7_value !== (t7_value = /*type_desc*/ ctx[5] + "")) set_data_dev(t7, t7_value);
    			if (dirty & /*payments*/ 1 && t9_value !== (t9_value = /*end_epoch*/ ctx[7] + "")) set_data_dev(t9, t9_value);
    			if (dirty & /*payments*/ 1 && t11_value !== (t11_value = /*amount*/ ctx[8] + "")) set_data_dev(t11, t11_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(tr);
    			if (if_block) if_block.d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block$4.name,
    		type: "each",
    		source: "(34:12) {#each payments as {uid, note, type_desc, payee, end_epoch, amount}}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$9(ctx) {
    	let div;
    	let h2;
    	let t0;
    	let t1;
    	let current_block_type_index;
    	let if_block1;
    	let current;
    	let if_block0 = /*payments*/ ctx[0] && /*payments*/ ctx[0].length > 0 && !/*has_notes*/ ctx[1] && create_if_block_4$2(ctx);
    	const if_block_creators = [create_if_block$5, create_else_block_1$4];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*payments*/ ctx[0]) return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block1 = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	const block = {
    		c: function create() {
    			div = element("div");
    			h2 = element("h2");
    			t0 = text("Autopay Instructions ");
    			if (if_block0) if_block0.c();
    			t1 = space();
    			if_block1.c();
    			attr_dev(h2, "class", "uk-text-center uk-text-uppercase uk-text-muted uk-text-light uk-margin-medium-bottom");
    			add_location(h2, file$9, 13, 2, 372);
    			add_location(div, file$9, 12, 0, 364);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, h2);
    			append_dev(h2, t0);
    			if (if_block0) if_block0.m(h2, null);
    			append_dev(div, t1);
    			if_blocks[current_block_type_index].m(div, null);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			if (/*payments*/ ctx[0] && /*payments*/ ctx[0].length > 0 && !/*has_notes*/ ctx[1]) {
    				if (if_block0) {
    					if (dirty & /*payments, has_notes*/ 3) {
    						transition_in(if_block0, 1);
    					}
    				} else {
    					if_block0 = create_if_block_4$2(ctx);
    					if_block0.c();
    					transition_in(if_block0, 1);
    					if_block0.m(h2, null);
    				}
    			} else if (if_block0) {
    				group_outros();

    				transition_out(if_block0, 1, 1, () => {
    					if_block0 = null;
    				});

    				check_outros();
    			}

    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block1 = if_blocks[current_block_type_index];

    				if (!if_block1) {
    					if_block1 = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block1.c();
    				} else {
    					if_block1.p(ctx, dirty);
    				}

    				transition_in(if_block1, 1);
    				if_block1.m(div, null);
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(if_block0);
    			transition_in(if_block1);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(if_block0);
    			transition_out(if_block1);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			if (if_block0) if_block0.d();
    			if_blocks[current_block_type_index].d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$9.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$9($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('AutoPay', slots, []);
    	let { account } = $$props;
    	let payments;
    	let has_notes = false;
    	const writable_props = ['account'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<AutoPay> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ('account' in $$props) $$invalidate(2, account = $$props.account);
    	};

    	$$self.$capture_state = () => ({
    		AutoPaySummary,
    		AddressNoteTip,
    		account,
    		payments,
    		has_notes
    	});

    	$$self.$inject_state = $$props => {
    		if ('account' in $$props) $$invalidate(2, account = $$props.account);
    		if ('payments' in $$props) $$invalidate(0, payments = $$props.payments);
    		if ('has_notes' in $$props) $$invalidate(1, has_notes = $$props.has_notes);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*account, payments*/ 5) {
    			if (account && account.autopay) {
    				$$invalidate(0, payments = account.autopay.payments);
    				$$invalidate(1, has_notes = payments.some(e => e.note != ""));
    			}
    		}
    	};

    	return [payments, has_notes, account];
    }

    class AutoPay extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$9, create_fragment$9, safe_not_equal, { account: 2 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "AutoPay",
    			options,
    			id: create_fragment$9.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*account*/ ctx[2] === undefined && !('account' in props)) {
    			console.warn("<AutoPay> was created without expected prop 'account'");
    		}
    	}

    	get account() {
    		throw new Error("<AutoPay>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set account(value) {
    		throw new Error("<AutoPay>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/validators/ValidatorModal.svelte generated by Svelte v3.44.2 */

    const { console: console_1 } = globals;
    const file$8 = "src/components/validators/ValidatorModal.svelte";

    // (38:0) {#if validator}
    function create_if_block$4(ctx) {
    	let div1;
    	let div0;
    	let button;
    	let t0;
    	let h2;
    	let t2;
    	let table;
    	let thead;
    	let tr0;
    	let th0;
    	let t3;
    	let th1;
    	let t4;
    	let tbody;
    	let tr1;
    	let td0;
    	let t6;
    	let td1;
    	let t7_value = /*validator*/ ctx[0].account_address + "";
    	let t7;
    	let t8;
    	let tr2;
    	let td2;
    	let t10;
    	let td3;
    	let t11_value = /*validator*/ ctx[0].vfn_full_ip + "";
    	let t11;
    	let t12;
    	let tr3;
    	let td4;
    	let t14;
    	let td5;
    	let t15_value = /*validator*/ ctx[0].validator_full_ip + "";
    	let t15;
    	let t16;
    	let tr4;
    	let td6;
    	let t18;
    	let td7;
    	let t19_value = /*validator*/ ctx[0].epochs_validating_and_mining + "";
    	let t19;
    	let t20;
    	let tr5;
    	let td8;
    	let t22;
    	let td9;
    	let t23_value = get_operator_account(/*validator*/ ctx[0]) + "";
    	let t23;
    	let t24;
    	let tr6;
    	let td10;
    	let t26;
    	let td11;
    	let t27_value = has_operator_balance(/*validator*/ ctx[0]) + "";
    	let t27;
    	let t28;
    	let tr7;
    	let td12;
    	let t30;
    	let td13;
    	let t31_value = can_create_account(/*validator*/ ctx[0]) + "";
    	let t31;
    	let t32;
    	let autopay;
    	let div1_id_value;
    	let current;

    	autopay = new AutoPay({
    			props: { account: /*validator*/ ctx[0] },
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			div1 = element("div");
    			div0 = element("div");
    			button = element("button");
    			t0 = space();
    			h2 = element("h2");
    			h2.textContent = "Validator Info";
    			t2 = space();
    			table = element("table");
    			thead = element("thead");
    			tr0 = element("tr");
    			th0 = element("th");
    			t3 = space();
    			th1 = element("th");
    			t4 = space();
    			tbody = element("tbody");
    			tr1 = element("tr");
    			td0 = element("td");
    			td0.textContent = "account address";
    			t6 = space();
    			td1 = element("td");
    			t7 = text(t7_value);
    			t8 = space();
    			tr2 = element("tr");
    			td2 = element("td");
    			td2.textContent = "fullnode network address";
    			t10 = space();
    			td3 = element("td");
    			t11 = text(t11_value);
    			t12 = space();
    			tr3 = element("tr");
    			td4 = element("td");
    			td4.textContent = "validator network address";
    			t14 = space();
    			td5 = element("td");
    			t15 = text(t15_value);
    			t16 = space();
    			tr4 = element("tr");
    			td6 = element("td");
    			td6.textContent = "epochs validating and mining";
    			t18 = space();
    			td7 = element("td");
    			t19 = text(t19_value);
    			t20 = space();
    			tr5 = element("tr");
    			td8 = element("td");
    			td8.textContent = "operator account";
    			t22 = space();
    			td9 = element("td");
    			t23 = text(t23_value);
    			t24 = space();
    			tr6 = element("tr");
    			td10 = element("td");
    			td10.textContent = "operator has positive balance";
    			t26 = space();
    			td11 = element("td");
    			t27 = text(t27_value);
    			t28 = space();
    			tr7 = element("tr");
    			td12 = element("td");
    			td12.textContent = "can create account";
    			t30 = space();
    			td13 = element("td");
    			t31 = text(t31_value);
    			t32 = space();
    			create_component(autopay.$$.fragment);
    			attr_dev(button, "class", "uk-modal-close-default");
    			attr_dev(button, "type", "button");
    			attr_dev(button, "uk-close", "");
    			add_location(button, file$8, 40, 10, 1389);
    			attr_dev(h2, "class", "uk-modal-title uk-text-muted");
    			add_location(h2, file$8, 41, 10, 1471);
    			add_location(th0, file$8, 45, 20, 1628);
    			add_location(th1, file$8, 46, 20, 1658);
    			add_location(tr0, file$8, 44, 16, 1603);
    			add_location(thead, file$8, 43, 12, 1579);
    			attr_dev(td0, "class", "uk-table-expand");
    			add_location(td0, file$8, 51, 18, 1770);
    			add_location(td1, file$8, 52, 18, 1837);
    			add_location(tr1, file$8, 50, 16, 1747);
    			add_location(td2, file$8, 55, 20, 1937);
    			attr_dev(td3, "class", "uk-text-break");
    			add_location(td3, file$8, 56, 20, 1991);
    			add_location(tr2, file$8, 54, 16, 1912);
    			add_location(td4, file$8, 59, 20, 2109);
    			add_location(td5, file$8, 60, 20, 2164);
    			add_location(tr3, file$8, 58, 16, 2084);
    			add_location(td6, file$8, 63, 20, 2266);
    			add_location(td7, file$8, 64, 20, 2324);
    			add_location(tr4, file$8, 62, 16, 2241);
    			add_location(td8, file$8, 67, 20, 2437);
    			add_location(td9, file$8, 68, 20, 2483);
    			add_location(tr5, file$8, 66, 16, 2412);
    			add_location(td10, file$8, 71, 20, 2589);
    			add_location(td11, file$8, 72, 20, 2648);
    			add_location(tr6, file$8, 70, 16, 2564);
    			add_location(td12, file$8, 75, 20, 2754);
    			add_location(td13, file$8, 76, 20, 2802);
    			add_location(tr7, file$8, 74, 16, 2729);
    			add_location(tbody, file$8, 49, 12, 1723);
    			attr_dev(table, "class", "uk-table");
    			add_location(table, file$8, 42, 10, 1542);
    			attr_dev(div0, "id", "validator-modal-body");
    			attr_dev(div0, "class", "uk-modal-dialog uk-modal-body svelte-zc3fmg");
    			add_location(div0, file$8, 39, 6, 1309);
    			attr_dev(div1, "id", div1_id_value = /*id*/ ctx[1] ? /*id*/ ctx[1] : 'validator-modal');
    			attr_dev(div1, "uk-modal", "");
    			attr_dev(div1, "class", "svelte-zc3fmg");
    			add_location(div1, file$8, 38, 2, 1253);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div1, anchor);
    			append_dev(div1, div0);
    			append_dev(div0, button);
    			append_dev(div0, t0);
    			append_dev(div0, h2);
    			append_dev(div0, t2);
    			append_dev(div0, table);
    			append_dev(table, thead);
    			append_dev(thead, tr0);
    			append_dev(tr0, th0);
    			append_dev(tr0, t3);
    			append_dev(tr0, th1);
    			append_dev(table, t4);
    			append_dev(table, tbody);
    			append_dev(tbody, tr1);
    			append_dev(tr1, td0);
    			append_dev(tr1, t6);
    			append_dev(tr1, td1);
    			append_dev(td1, t7);
    			append_dev(tbody, t8);
    			append_dev(tbody, tr2);
    			append_dev(tr2, td2);
    			append_dev(tr2, t10);
    			append_dev(tr2, td3);
    			append_dev(td3, t11);
    			append_dev(tbody, t12);
    			append_dev(tbody, tr3);
    			append_dev(tr3, td4);
    			append_dev(tr3, t14);
    			append_dev(tr3, td5);
    			append_dev(td5, t15);
    			append_dev(tbody, t16);
    			append_dev(tbody, tr4);
    			append_dev(tr4, td6);
    			append_dev(tr4, t18);
    			append_dev(tr4, td7);
    			append_dev(td7, t19);
    			append_dev(tbody, t20);
    			append_dev(tbody, tr5);
    			append_dev(tr5, td8);
    			append_dev(tr5, t22);
    			append_dev(tr5, td9);
    			append_dev(td9, t23);
    			append_dev(tbody, t24);
    			append_dev(tbody, tr6);
    			append_dev(tr6, td10);
    			append_dev(tr6, t26);
    			append_dev(tr6, td11);
    			append_dev(td11, t27);
    			append_dev(tbody, t28);
    			append_dev(tbody, tr7);
    			append_dev(tr7, td12);
    			append_dev(tr7, t30);
    			append_dev(tr7, td13);
    			append_dev(td13, t31);
    			append_dev(div0, t32);
    			mount_component(autopay, div0, null);
    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			if ((!current || dirty & /*validator*/ 1) && t7_value !== (t7_value = /*validator*/ ctx[0].account_address + "")) set_data_dev(t7, t7_value);
    			if ((!current || dirty & /*validator*/ 1) && t11_value !== (t11_value = /*validator*/ ctx[0].vfn_full_ip + "")) set_data_dev(t11, t11_value);
    			if ((!current || dirty & /*validator*/ 1) && t15_value !== (t15_value = /*validator*/ ctx[0].validator_full_ip + "")) set_data_dev(t15, t15_value);
    			if ((!current || dirty & /*validator*/ 1) && t19_value !== (t19_value = /*validator*/ ctx[0].epochs_validating_and_mining + "")) set_data_dev(t19, t19_value);
    			if ((!current || dirty & /*validator*/ 1) && t23_value !== (t23_value = get_operator_account(/*validator*/ ctx[0]) + "")) set_data_dev(t23, t23_value);
    			if ((!current || dirty & /*validator*/ 1) && t27_value !== (t27_value = has_operator_balance(/*validator*/ ctx[0]) + "")) set_data_dev(t27, t27_value);
    			if ((!current || dirty & /*validator*/ 1) && t31_value !== (t31_value = can_create_account(/*validator*/ ctx[0]) + "")) set_data_dev(t31, t31_value);
    			const autopay_changes = {};
    			if (dirty & /*validator*/ 1) autopay_changes.account = /*validator*/ ctx[0];
    			autopay.$set(autopay_changes);

    			if (!current || dirty & /*id*/ 2 && div1_id_value !== (div1_id_value = /*id*/ ctx[1] ? /*id*/ ctx[1] : 'validator-modal')) {
    				attr_dev(div1, "id", div1_id_value);
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(autopay.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(autopay.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div1);
    			destroy_component(autopay);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$4.name,
    		type: "if",
    		source: "(38:0) {#if validator}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$8(ctx) {
    	let if_block_anchor;
    	let current;
    	let if_block = /*validator*/ ctx[0] && create_if_block$4(ctx);

    	const block = {
    		c: function create() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			if (if_block) if_block.m(target, anchor);
    			insert_dev(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			if (/*validator*/ ctx[0]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty & /*validator*/ 1) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block$4(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach_dev(if_block_anchor);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$8.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function get_operator_account(validator) {
    	let config = validator.validator_config;

    	return config && config.operator_account
    	? config.operator_account
    	: "Not Found";
    }

    function has_operator_balance(validator) {
    	let config = validator.validator_config;

    	return config && config.operator_has_balance != null
    	? config.operator_has_balance ? "Yes" : "No"
    	: "Not Found";
    }

    function can_create_account(validator) {
    	console.log(validator.epochs_since_last_account_creation);
    	const epochs_to_wait = 13; // TODO fetch #days from the chain (EPOCHS_UNTIL_ACCOUNT_CREATION)

    	if (validator.epochs_since_last_account_creation > epochs_to_wait) {
    		return "Yes";
    	}

    	let diff = epochs_to_wait - validator.epochs_since_last_account_creation;
    	return "No (" + diff + " epoch" + (diff == 1 ? "" : "s") + " to enable)";
    }

    function instance$8($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('ValidatorModal', slots, []);
    	let { validator } = $$props;
    	let { id } = $$props;
    	const writable_props = ['validator', 'id'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console_1.warn(`<ValidatorModal> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ('validator' in $$props) $$invalidate(0, validator = $$props.validator);
    		if ('id' in $$props) $$invalidate(1, id = $$props.id);
    	};

    	$$self.$capture_state = () => ({
    		AutoPay,
    		validator,
    		id,
    		get_operator_account,
    		has_operator_balance,
    		can_create_account
    	});

    	$$self.$inject_state = $$props => {
    		if ('validator' in $$props) $$invalidate(0, validator = $$props.validator);
    		if ('id' in $$props) $$invalidate(1, id = $$props.id);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [validator, id];
    }

    class ValidatorModal extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$8, create_fragment$8, safe_not_equal, { validator: 0, id: 1 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "ValidatorModal",
    			options,
    			id: create_fragment$8.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*validator*/ ctx[0] === undefined && !('validator' in props)) {
    			console_1.warn("<ValidatorModal> was created without expected prop 'validator'");
    		}

    		if (/*id*/ ctx[1] === undefined && !('id' in props)) {
    			console_1.warn("<ValidatorModal> was created without expected prop 'id'");
    		}
    	}

    	get validator() {
    		throw new Error("<ValidatorModal>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set validator(value) {
    		throw new Error("<ValidatorModal>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get id() {
    		throw new Error("<ValidatorModal>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set id(value) {
    		throw new Error("<ValidatorModal>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/validators/Vals.svelte generated by Svelte v3.44.2 */
    const file$7 = "src/components/validators/Vals.svelte";

    function get_each_context$3(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[12] = list[i];
    	child_ctx[14] = i;
    	return child_ctx;
    }

    function get_each_context_1$2(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[15] = list[i];
    	return child_ctx;
    }

    // (44:34) {#if !has_notes}
    function create_if_block_5$1(ctx) {
    	let addressnotetip;
    	let current;
    	addressnotetip = new AddressNoteTip({ $$inline: true });

    	const block = {
    		c: function create() {
    			create_component(addressnotetip.$$.fragment);
    		},
    		m: function mount(target, anchor) {
    			mount_component(addressnotetip, target, anchor);
    			current = true;
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(addressnotetip.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(addressnotetip.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(addressnotetip, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_5$1.name,
    		type: "if",
    		source: "(44:34) {#if !has_notes}",
    		ctx
    	});

    	return block;
    }

    // (98:2) {:else}
    function create_else_block_1$3(ctx) {
    	let network;
    	let current;

    	network = new Network({
    			props: { data: /*data*/ ctx[0] },
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			create_component(network.$$.fragment);
    		},
    		m: function mount(target, anchor) {
    			mount_component(network, target, anchor);
    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			const network_changes = {};
    			if (dirty & /*data*/ 1) network_changes.data = /*data*/ ctx[0];
    			network.$set(network_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(network.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(network.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(network, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block_1$3.name,
    		type: "else",
    		source: "(98:2) {:else}",
    		ctx
    	});

    	return block;
    }

    // (52:2) {#if view == "Chain"}
    function create_if_block$3(ctx) {
    	let div;
    	let table;
    	let thead;
    	let tr;
    	let t0;
    	let th0;
    	let t2;
    	let t3;
    	let th1;
    	let t4;
    	let tbody;
    	let if_block = /*has_notes*/ ctx[6] && create_if_block_4$1(ctx);
    	let each_value_1 = /*sortableColumns*/ ctx[7];
    	validate_each_argument(each_value_1);
    	let each_blocks_1 = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks_1[i] = create_each_block_1$2(get_each_context_1$2(ctx, each_value_1, i));
    	}

    	let each_value = /*set*/ ctx[1];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$3(get_each_context$3(ctx, each_value, i));
    	}

    	const block = {
    		c: function create() {
    			div = element("div");
    			table = element("table");
    			thead = element("thead");
    			tr = element("tr");
    			if (if_block) if_block.c();
    			t0 = space();
    			th0 = element("th");
    			th0.textContent = "account";
    			t2 = space();

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].c();
    			}

    			t3 = space();
    			th1 = element("th");
    			t4 = space();
    			tbody = element("tbody");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr_dev(th0, "class", "uk-text-center");
    			add_location(th0, file$7, 60, 14, 2124);
    			add_location(th1, file$7, 73, 14, 2715);
    			add_location(tr, file$7, 56, 10, 2002);
    			add_location(thead, file$7, 55, 8, 1984);
    			add_location(tbody, file$7, 76, 8, 2766);
    			attr_dev(table, "class", "uk-table uk-table-hover uk-text-muted");
    			add_location(table, file$7, 54, 6, 1922);
    			attr_dev(div, "class", "uk-overflow-auto");
    			add_location(div, file$7, 53, 4, 1885);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, table);
    			append_dev(table, thead);
    			append_dev(thead, tr);
    			if (if_block) if_block.m(tr, null);
    			append_dev(tr, t0);
    			append_dev(tr, th0);
    			append_dev(tr, t2);

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].m(tr, null);
    			}

    			append_dev(tr, t3);
    			append_dev(tr, th1);
    			append_dev(table, t4);
    			append_dev(table, tbody);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(tbody, null);
    			}
    		},
    		p: function update(ctx, dirty) {
    			if (/*has_notes*/ ctx[6]) {
    				if (if_block) ; else {
    					if_block = create_if_block_4$1(ctx);
    					if_block.c();
    					if_block.m(tr, t0);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (dirty & /*thOnClick, sortableColumns, sortOrder, sortOption*/ 408) {
    				each_value_1 = /*sortableColumns*/ ctx[7];
    				validate_each_argument(each_value_1);
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1$2(ctx, each_value_1, i);

    					if (each_blocks_1[i]) {
    						each_blocks_1[i].p(child_ctx, dirty);
    					} else {
    						each_blocks_1[i] = create_each_block_1$2(child_ctx);
    						each_blocks_1[i].c();
    						each_blocks_1[i].m(tr, t3);
    					}
    				}

    				for (; i < each_blocks_1.length; i += 1) {
    					each_blocks_1[i].d(1);
    				}

    				each_blocks_1.length = each_value_1.length;
    			}

    			if (dirty & /*set, data, selectedVal, modal_id, has_notes*/ 71) {
    				each_value = /*set*/ ctx[1];
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$3(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block$3(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(tbody, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			if (if_block) if_block.d();
    			destroy_each(each_blocks_1, detaching);
    			destroy_each(each_blocks, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$3.name,
    		type: "if",
    		source: "(52:2) {#if view == \\\"Chain\\\"}",
    		ctx
    	});

    	return block;
    }

    // (58:14) {#if has_notes}
    function create_if_block_4$1(ctx) {
    	let th;

    	const block = {
    		c: function create() {
    			th = element("th");
    			th.textContent = "note";
    			attr_dev(th, "class", "uk-text-center");
    			add_location(th, file$7, 58, 16, 2053);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, th, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(th);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_4$1.name,
    		type: "if",
    		source: "(58:14) {#if has_notes}",
    		ctx
    	});

    	return block;
    }

    // (65:18) {#if sortOption == col.sortKey}
    function create_if_block_2$3(ctx) {
    	let if_block_anchor;

    	function select_block_type_1(ctx, dirty) {
    		if (/*sortOrder*/ ctx[4] == 1) return create_if_block_3$2;
    		return create_else_block$3;
    	}

    	let current_block_type = select_block_type_1(ctx);
    	let if_block = current_block_type(ctx);

    	const block = {
    		c: function create() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		m: function mount(target, anchor) {
    			if_block.m(target, anchor);
    			insert_dev(target, if_block_anchor, anchor);
    		},
    		p: function update(ctx, dirty) {
    			if (current_block_type !== (current_block_type = select_block_type_1(ctx))) {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			}
    		},
    		d: function destroy(detaching) {
    			if_block.d(detaching);
    			if (detaching) detach_dev(if_block_anchor);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_2$3.name,
    		type: "if",
    		source: "(65:18) {#if sortOption == col.sortKey}",
    		ctx
    	});

    	return block;
    }

    // (68:20) {:else}
    function create_else_block$3(ctx) {
    	let span;

    	const block = {
    		c: function create() {
    			span = element("span");
    			attr_dev(span, "uk-icon", "icon: triangle-down");
    			add_location(span, file$7, 68, 22, 2563);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, span, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(span);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block$3.name,
    		type: "else",
    		source: "(68:20) {:else}",
    		ctx
    	});

    	return block;
    }

    // (66:20) {#if sortOrder == 1}
    function create_if_block_3$2(ctx) {
    	let span;

    	const block = {
    		c: function create() {
    			span = element("span");
    			attr_dev(span, "uk-icon", "icon: triangle-up");
    			add_location(span, file$7, 66, 22, 2471);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, span, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(span);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_3$2.name,
    		type: "if",
    		source: "(66:20) {#if sortOrder == 1}",
    		ctx
    	});

    	return block;
    }

    // (62:14) {#each sortableColumns as col}
    function create_each_block_1$2(ctx) {
    	let th;
    	let span;
    	let t0_value = /*col*/ ctx[15].label + "";
    	let t0;
    	let t1;
    	let mounted;
    	let dispose;
    	let if_block = /*sortOption*/ ctx[3] == /*col*/ ctx[15].sortKey && create_if_block_2$3(ctx);

    	function click_handler_1() {
    		return /*click_handler_1*/ ctx[10](/*col*/ ctx[15]);
    	}

    	const block = {
    		c: function create() {
    			th = element("th");
    			span = element("span");
    			t0 = text(t0_value);
    			t1 = space();
    			if (if_block) if_block.c();
    			attr_dev(span, "class", "disable-select");
    			add_location(span, file$7, 63, 18, 2310);
    			attr_dev(th, "class", "uk-text-right");
    			add_location(th, file$7, 62, 16, 2225);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, th, anchor);
    			append_dev(th, span);
    			append_dev(span, t0);
    			append_dev(th, t1);
    			if (if_block) if_block.m(th, null);

    			if (!mounted) {
    				dispose = listen_dev(th, "click", click_handler_1, false, false, false);
    				mounted = true;
    			}
    		},
    		p: function update(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (/*sortOption*/ ctx[3] == /*col*/ ctx[15].sortKey) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_2$3(ctx);
    					if_block.c();
    					if_block.m(th, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(th);
    			if (if_block) if_block.d();
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block_1$2.name,
    		type: "each",
    		source: "(62:14) {#each sortableColumns as col}",
    		ctx
    	});

    	return block;
    }

    // (80:14) {#if has_notes}
    function create_if_block_1$3(ctx) {
    	let td;
    	let t_value = /*val*/ ctx[12].note + "";
    	let t;

    	const block = {
    		c: function create() {
    			td = element("td");
    			t = text(t_value);
    			attr_dev(td, "class", "uk-text-center");
    			add_location(td, file$7, 80, 16, 2985);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, td, anchor);
    			append_dev(td, t);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*set*/ 2 && t_value !== (t_value = /*val*/ ctx[12].note + "")) set_data_dev(t, t_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(td);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_1$3.name,
    		type: "if",
    		source: "(80:14) {#if has_notes}",
    		ctx
    	});

    	return block;
    }

    // (78:10) {#each set as val, i}
    function create_each_block$3(ctx) {
    	let tr;
    	let t0;
    	let td0;
    	let t1_value = /*val*/ ctx[12].account_address + "";
    	let t1;
    	let t2;
    	let td1;
    	let t3_value = /*val*/ ctx[12].account_address + "";
    	let t3;
    	let t4;
    	let td2;
    	let t5_value = /*val*/ ctx[12].voting_power + "";
    	let t5;
    	let t6;
    	let td3;
    	let t7_value = /*val*/ ctx[12].count_proofs_in_epoch + "";
    	let t7;
    	let t8;
    	let td4;
    	let t9_value = /*val*/ ctx[12].tower_height + "";
    	let t9;
    	let t10;
    	let td5;
    	let t11_value = /*val*/ ctx[12].vote_count_in_epoch + "";
    	let t11;
    	let t12;
    	let td6;
    	let t13_value = /*val*/ ctx[12].prop_count_in_epoch + "";
    	let t13;
    	let t14;
    	let td7;
    	let span;
    	let t15;
    	let tr_class_value;
    	let mounted;
    	let dispose;
    	let if_block = /*has_notes*/ ctx[6] && create_if_block_1$3(ctx);

    	function click_handler_2() {
    		return /*click_handler_2*/ ctx[11](/*val*/ ctx[12]);
    	}

    	const block = {
    		c: function create() {
    			tr = element("tr");
    			if (if_block) if_block.c();
    			t0 = space();
    			td0 = element("td");
    			t1 = text(t1_value);
    			t2 = space();
    			td1 = element("td");
    			t3 = text(t3_value);
    			t4 = space();
    			td2 = element("td");
    			t5 = text(t5_value);
    			t6 = space();
    			td3 = element("td");
    			t7 = text(t7_value);
    			t8 = space();
    			td4 = element("td");
    			t9 = text(t9_value);
    			t10 = space();
    			td5 = element("td");
    			t11 = text(t11_value);
    			t12 = space();
    			td6 = element("td");
    			t13 = text(t13_value);
    			t14 = space();
    			td7 = element("td");
    			span = element("span");
    			t15 = space();
    			attr_dev(td0, "class", "uk-visible@s uk-text-center");
    			add_location(td0, file$7, 82, 14, 3062);
    			attr_dev(td1, "class", "uk-hidden@s uk-text-truncate");
    			add_location(td1, file$7, 83, 14, 3143);
    			attr_dev(td2, "class", "uk-text-right");
    			add_location(td2, file$7, 84, 14, 3225);
    			attr_dev(td3, "class", "uk-text-right");
    			add_location(td3, file$7, 85, 14, 3289);
    			attr_dev(td4, "class", "uk-text-right");
    			add_location(td4, file$7, 86, 14, 3362);
    			attr_dev(td5, "class", "uk-text-right");
    			add_location(td5, file$7, 87, 14, 3426);
    			attr_dev(td6, "class", "uk-text-right");
    			add_location(td6, file$7, 88, 14, 3497);
    			attr_dev(span, "uk-icon", "icon: info");
    			attr_dev(span, "uk-toggle", "target: #" + modal_id$1);
    			add_location(span, file$7, 90, 16, 3589);
    			add_location(td7, file$7, 89, 14, 3568);

    			attr_dev(tr, "class", tr_class_value = "" + (null_to_empty(/*val*/ ctx[12].account_address === /*data*/ ctx[0].account_view.address
    			? 'owner'
    			: '') + " svelte-n6q91t"));

    			add_location(tr, file$7, 78, 10, 2816);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, tr, anchor);
    			if (if_block) if_block.m(tr, null);
    			append_dev(tr, t0);
    			append_dev(tr, td0);
    			append_dev(td0, t1);
    			append_dev(tr, t2);
    			append_dev(tr, td1);
    			append_dev(td1, t3);
    			append_dev(tr, t4);
    			append_dev(tr, td2);
    			append_dev(td2, t5);
    			append_dev(tr, t6);
    			append_dev(tr, td3);
    			append_dev(td3, t7);
    			append_dev(tr, t8);
    			append_dev(tr, td4);
    			append_dev(td4, t9);
    			append_dev(tr, t10);
    			append_dev(tr, td5);
    			append_dev(td5, t11);
    			append_dev(tr, t12);
    			append_dev(tr, td6);
    			append_dev(td6, t13);
    			append_dev(tr, t14);
    			append_dev(tr, td7);
    			append_dev(td7, span);
    			append_dev(tr, t15);

    			if (!mounted) {
    				dispose = listen_dev(tr, "click", click_handler_2, false, false, false);
    				mounted = true;
    			}
    		},
    		p: function update(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (/*has_notes*/ ctx[6]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_1$3(ctx);
    					if_block.c();
    					if_block.m(tr, t0);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (dirty & /*set*/ 2 && t1_value !== (t1_value = /*val*/ ctx[12].account_address + "")) set_data_dev(t1, t1_value);
    			if (dirty & /*set*/ 2 && t3_value !== (t3_value = /*val*/ ctx[12].account_address + "")) set_data_dev(t3, t3_value);
    			if (dirty & /*set*/ 2 && t5_value !== (t5_value = /*val*/ ctx[12].voting_power + "")) set_data_dev(t5, t5_value);
    			if (dirty & /*set*/ 2 && t7_value !== (t7_value = /*val*/ ctx[12].count_proofs_in_epoch + "")) set_data_dev(t7, t7_value);
    			if (dirty & /*set*/ 2 && t9_value !== (t9_value = /*val*/ ctx[12].tower_height + "")) set_data_dev(t9, t9_value);
    			if (dirty & /*set*/ 2 && t11_value !== (t11_value = /*val*/ ctx[12].vote_count_in_epoch + "")) set_data_dev(t11, t11_value);
    			if (dirty & /*set*/ 2 && t13_value !== (t13_value = /*val*/ ctx[12].prop_count_in_epoch + "")) set_data_dev(t13, t13_value);

    			if (dirty & /*set, data*/ 3 && tr_class_value !== (tr_class_value = "" + (null_to_empty(/*val*/ ctx[12].account_address === /*data*/ ctx[0].account_view.address
    			? 'owner'
    			: '') + " svelte-n6q91t"))) {
    				attr_dev(tr, "class", tr_class_value);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(tr);
    			if (if_block) if_block.d();
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block$3.name,
    		type: "each",
    		source: "(78:10) {#each set as val, i}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$7(ctx) {
    	let main;
    	let h2;
    	let span;
    	let t0_value = /*set*/ ctx[1].length + "";
    	let t0;
    	let t1;
    	let t2;
    	let div;
    	let label0;
    	let input0;
    	let t3;
    	let t4;
    	let label1;
    	let input1;
    	let t5;
    	let t6;
    	let current_block_type_index;
    	let if_block1;
    	let t7;
    	let validatormodal;
    	let current;
    	let mounted;
    	let dispose;
    	let if_block0 = !/*has_notes*/ ctx[6] && create_if_block_5$1(ctx);
    	const if_block_creators = [create_if_block$3, create_else_block_1$3];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*view*/ ctx[5] == "Chain") return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block1 = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	validatormodal = new ValidatorModal({
    			props: {
    				validator: /*selectedVal*/ ctx[2],
    				id: modal_id$1
    			},
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			main = element("main");
    			h2 = element("h2");
    			span = element("span");
    			t0 = text(t0_value);
    			t1 = text(" Validators ");
    			if (if_block0) if_block0.c();
    			t2 = space();
    			div = element("div");
    			label0 = element("label");
    			input0 = element("input");
    			t3 = text(" Chain");
    			t4 = space();
    			label1 = element("label");
    			input1 = element("input");
    			t5 = text(" Network");
    			t6 = space();
    			if_block1.c();
    			t7 = space();
    			create_component(validatormodal.$$.fragment);
    			add_location(span, file$7, 43, 4, 1364);
    			attr_dev(h2, "class", "uk-text-center uk-text-uppercase uk-text-muted uk-text-light uk-margin-medium-bottom");
    			add_location(h2, file$7, 42, 2, 1262);
    			attr_dev(input0, "class", "uk-radio");
    			attr_dev(input0, "type", "radio");
    			attr_dev(input0, "name", "radio2");
    			input0.value = "Chain";
    			input0.checked = true;
    			add_location(input0, file$7, 47, 11, 1661);
    			add_location(label0, file$7, 47, 4, 1654);
    			attr_dev(input1, "class", "uk-radio");
    			attr_dev(input1, "type", "radio");
    			attr_dev(input1, "name", "radio2");
    			input1.value = "Network";
    			add_location(input1, file$7, 48, 11, 1760);
    			add_location(label1, file$7, 48, 4, 1753);
    			attr_dev(div, "id", "radio2");
    			attr_dev(div, "class", "uk-margin uk-grid-small uk-child-width-auto uk-align-center uk-text-center");
    			attr_dev(div, "uk-grid", "");
    			add_location(div, file$7, 46, 2, 1452);
    			attr_dev(main, "uk-height-viewport", "expand: true");
    			add_location(main, file$7, 41, 0, 1219);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			append_dev(main, h2);
    			append_dev(h2, span);
    			append_dev(span, t0);
    			append_dev(span, t1);
    			if (if_block0) if_block0.m(span, null);
    			append_dev(main, t2);
    			append_dev(main, div);
    			append_dev(div, label0);
    			append_dev(label0, input0);
    			append_dev(label0, t3);
    			append_dev(div, t4);
    			append_dev(div, label1);
    			append_dev(label1, input1);
    			append_dev(label1, t5);
    			append_dev(main, t6);
    			if_blocks[current_block_type_index].m(main, null);
    			append_dev(main, t7);
    			mount_component(validatormodal, main, null);
    			current = true;

    			if (!mounted) {
    				dispose = listen_dev(div, "click", /*click_handler*/ ctx[9], false, false, false);
    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if ((!current || dirty & /*set*/ 2) && t0_value !== (t0_value = /*set*/ ctx[1].length + "")) set_data_dev(t0, t0_value);

    			if (!/*has_notes*/ ctx[6]) {
    				if (if_block0) {
    					if (dirty & /*has_notes*/ 64) {
    						transition_in(if_block0, 1);
    					}
    				} else {
    					if_block0 = create_if_block_5$1(ctx);
    					if_block0.c();
    					transition_in(if_block0, 1);
    					if_block0.m(span, null);
    				}
    			} else if (if_block0) {
    				group_outros();

    				transition_out(if_block0, 1, 1, () => {
    					if_block0 = null;
    				});

    				check_outros();
    			}

    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block1 = if_blocks[current_block_type_index];

    				if (!if_block1) {
    					if_block1 = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block1.c();
    				} else {
    					if_block1.p(ctx, dirty);
    				}

    				transition_in(if_block1, 1);
    				if_block1.m(main, t7);
    			}

    			const validatormodal_changes = {};
    			if (dirty & /*selectedVal*/ 4) validatormodal_changes.validator = /*selectedVal*/ ctx[2];
    			validatormodal.$set(validatormodal_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(if_block0);
    			transition_in(if_block1);
    			transition_in(validatormodal.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(if_block0);
    			transition_out(if_block1);
    			transition_out(validatormodal.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    			if (if_block0) if_block0.d();
    			if_blocks[current_block_type_index].d();
    			destroy_component(validatormodal);
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$7.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    const modal_id$1 = "vals-tab-val-modal";

    function instance$7($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Vals', slots, []);
    	let { data } = $$props;
    	let view = "Chain";
    	let set = [];
    	let selectedVal = null;

    	let sortableColumns = [
    		{
    			label: "voting power",
    			sortKey: "voting_power"
    		},
    		{
    			label: "proofs in epoch",
    			sortKey: "count_proofs_in_epoch"
    		},
    		{
    			label: "tower height",
    			sortKey: "tower_height"
    		},
    		{
    			label: "votes in epoch",
    			sortKey: "vote_count_in_epoch"
    		},
    		{
    			label: "props in epoch",
    			sortKey: "prop_count_in_epoch"
    		}
    	];

    	let sortOption = "voting_power";
    	let sortOrder = 1;
    	let has_notes = false;

    	function thOnClick(key) {
    		if (sortOption == key) {
    			$$invalidate(4, sortOrder = -sortOrder);
    		}

    		$$invalidate(3, sortOption = key);
    	}

    	const writable_props = ['data'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Vals> was created with unknown prop '${key}'`);
    	});

    	const click_handler = () => {
    		$$invalidate(5, view = document.querySelector('input[name="radio2"]:checked').value);
    	};

    	const click_handler_1 = col => thOnClick(col.sortKey);
    	const click_handler_2 = val => $$invalidate(2, selectedVal = val);

    	$$self.$$set = $$props => {
    		if ('data' in $$props) $$invalidate(0, data = $$props.data);
    	};

    	$$self.$capture_state = () => ({
    		AddressNoteTip,
    		Network,
    		ValidatorModal,
    		data,
    		modal_id: modal_id$1,
    		view,
    		set,
    		selectedVal,
    		sortableColumns,
    		sortOption,
    		sortOrder,
    		has_notes,
    		thOnClick
    	});

    	$$self.$inject_state = $$props => {
    		if ('data' in $$props) $$invalidate(0, data = $$props.data);
    		if ('view' in $$props) $$invalidate(5, view = $$props.view);
    		if ('set' in $$props) $$invalidate(1, set = $$props.set);
    		if ('selectedVal' in $$props) $$invalidate(2, selectedVal = $$props.selectedVal);
    		if ('sortableColumns' in $$props) $$invalidate(7, sortableColumns = $$props.sortableColumns);
    		if ('sortOption' in $$props) $$invalidate(3, sortOption = $$props.sortOption);
    		if ('sortOrder' in $$props) $$invalidate(4, sortOrder = $$props.sortOrder);
    		if ('has_notes' in $$props) $$invalidate(6, has_notes = $$props.has_notes);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*data, set, selectedVal*/ 7) {
    			if (data.chain_view && data.chain_view.validator_view) {
    				$$invalidate(1, set = data.chain_view.validator_view);
    				$$invalidate(6, has_notes = set.some(e => e.note != ""));

    				if (selectedVal == null) {
    					// initial selection
    					$$invalidate(2, selectedVal = set[0]);
    				}
    			}
    		}

    		if ($$self.$$.dirty & /*set, sortOption, sortOrder*/ 26) {
    			$$invalidate(1, set = set.sort((a, b) => a[sortOption] > b[sortOption] ? sortOrder : -sortOrder));
    		}
    	};

    	return [
    		data,
    		set,
    		selectedVal,
    		sortOption,
    		sortOrder,
    		view,
    		has_notes,
    		sortableColumns,
    		thOnClick,
    		click_handler,
    		click_handler_1,
    		click_handler_2
    	];
    }

    class Vals extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$7, create_fragment$7, safe_not_equal, { data: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Vals",
    			options,
    			id: create_fragment$7.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*data*/ ctx[0] === undefined && !('data' in props)) {
    			console.warn("<Vals> was created without expected prop 'data'");
    		}
    	}

    	get data() {
    		throw new Error("<Vals>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set data(value) {
    		throw new Error("<Vals>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    const subscriber_queue = [];
    /**
     * Create a `Writable` store that allows both updating and reading by subscription.
     * @param {*=}value initial value
     * @param {StartStopNotifier=}start start and stop notifications for subscriptions
     */
    function writable(value, start = noop) {
        let stop;
        const subscribers = new Set();
        function set(new_value) {
            if (safe_not_equal(value, new_value)) {
                value = new_value;
                if (stop) { // store is ready
                    const run_queue = !subscriber_queue.length;
                    for (const subscriber of subscribers) {
                        subscriber[1]();
                        subscriber_queue.push(subscriber, value);
                    }
                    if (run_queue) {
                        for (let i = 0; i < subscriber_queue.length; i += 2) {
                            subscriber_queue[i][0](subscriber_queue[i + 1]);
                        }
                        subscriber_queue.length = 0;
                    }
                }
            }
        }
        function update(fn) {
            set(fn(value));
        }
        function subscribe(run, invalidate = noop) {
            const subscriber = [run, invalidate];
            subscribers.add(subscriber);
            if (subscribers.size === 1) {
                stop = start(set) || noop;
            }
            run(value);
            return () => {
                subscribers.delete(subscriber);
                if (subscribers.size === 0) {
                    stop();
                    stop = null;
                }
            };
        }
        return { set, update, subscribe };
    }

    const chainInfo = writable('Chain');
    chainInfo.set("{}");
    let uri = "http://" + location.host + "/vitals";
    let sse = new EventSource(uri);
    sse.onmessage = function (msg) {
        chainInfo.update(existing => msg.data);
    };

    /* src/components/upgrade/InProgress.svelte generated by Svelte v3.44.2 */
    const file$6 = "src/components/upgrade/InProgress.svelte";

    function get_each_context$2(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[6] = list[i];
    	child_ctx[8] = i;
    	return child_ctx;
    }

    function get_each_context_1$1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[9] = list[i];
    	child_ctx[8] = i;
    	return child_ctx;
    }

    // (53:10) {#each prop.validators as val, i}
    function create_each_block_1$1(ctx) {
    	let p;
    	let t_value = /*val*/ ctx[9] + "";
    	let t;

    	const block = {
    		c: function create() {
    			p = element("p");
    			t = text(t_value);
    			add_location(p, file$6, 53, 12, 1577);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, p, anchor);
    			append_dev(p, t);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*vote_counts*/ 1 && t_value !== (t_value = /*val*/ ctx[9] + "")) set_data_dev(t, t_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(p);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block_1$1.name,
    		type: "each",
    		source: "(53:10) {#each prop.validators as val, i}",
    		ctx
    	});

    	return block;
    }

    // (44:8) {#each vote_counts as prop, i}
    function create_each_block$2(ctx) {
    	let h5;
    	let t0;
    	let t1_value = /*i*/ ctx[8] + 1 + "";
    	let t1;
    	let t2;
    	let p;
    	let t3_value = /*prop*/ ctx[6].validators.length + "";
    	let t3;
    	let t4;
    	let t5;
    	let t6;
    	let t7;
    	let each_1_anchor;
    	let each_value_1 = /*prop*/ ctx[6].validators;
    	validate_each_argument(each_value_1);
    	let each_blocks = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks[i] = create_each_block_1$1(get_each_context_1$1(ctx, each_value_1, i));
    	}

    	const block = {
    		c: function create() {
    			h5 = element("h5");
    			t0 = text("proposal ");
    			t1 = text(t1_value);
    			t2 = space();
    			p = element("p");
    			t3 = text(t3_value);
    			t4 = text(" votes / ");
    			t5 = text(/*validator_count*/ ctx[1]);
    			t6 = text(" validators");
    			t7 = space();

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			each_1_anchor = empty();
    			attr_dev(h5, "class", "uk-text-muted uk-text-center uk-text-uppercase uk-text-small");
    			add_location(h5, file$6, 44, 10, 1236);
    			attr_dev(p, "class", "uk-text-uppercase uk-text-small");
    			add_location(p, file$6, 49, 10, 1388);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, h5, anchor);
    			append_dev(h5, t0);
    			append_dev(h5, t1);
    			insert_dev(target, t2, anchor);
    			insert_dev(target, p, anchor);
    			append_dev(p, t3);
    			append_dev(p, t4);
    			append_dev(p, t5);
    			append_dev(p, t6);
    			insert_dev(target, t7, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(target, anchor);
    			}

    			insert_dev(target, each_1_anchor, anchor);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*vote_counts*/ 1 && t3_value !== (t3_value = /*prop*/ ctx[6].validators.length + "")) set_data_dev(t3, t3_value);
    			if (dirty & /*validator_count*/ 2) set_data_dev(t5, /*validator_count*/ ctx[1]);

    			if (dirty & /*vote_counts*/ 1) {
    				each_value_1 = /*prop*/ ctx[6].validators;
    				validate_each_argument(each_value_1);
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1$1(ctx, each_value_1, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block_1$1(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_1.length;
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(h5);
    			if (detaching) detach_dev(t2);
    			if (detaching) detach_dev(p);
    			if (detaching) detach_dev(t7);
    			destroy_each(each_blocks, detaching);
    			if (detaching) detach_dev(each_1_anchor);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block$2.name,
    		type: "each",
    		source: "(44:8) {#each vote_counts as prop, i}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$6(ctx) {
    	let main;
    	let div2;
    	let h3;
    	let t1;
    	let table;
    	let tbody;
    	let tr0;
    	let td0;
    	let t3;
    	let td1;
    	let t4;
    	let t5;
    	let t6;
    	let t7;
    	let tr1;
    	let td2;
    	let t9;
    	let td3;
    	let t10;
    	let t11;
    	let hr;
    	let t12;
    	let div1;
    	let div0;
    	let each_value = /*vote_counts*/ ctx[0];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$2(get_each_context$2(ctx, each_value, i));
    	}

    	const block = {
    		c: function create() {
    			main = element("main");
    			div2 = element("div");
    			h3 = element("h3");
    			h3.textContent = "Voting In Progress";
    			t1 = space();
    			table = element("table");
    			tbody = element("tbody");
    			tr0 = element("tr");
    			td0 = element("td");
    			td0.textContent = "VOTERS:";
    			t3 = space();
    			td1 = element("td");
    			t4 = text(/*voters*/ ctx[3]);
    			t5 = text("/");
    			t6 = text(/*validator_count*/ ctx[1]);
    			t7 = space();
    			tr1 = element("tr");
    			td2 = element("td");
    			td2.textContent = "EXPIRATION:";
    			t9 = space();
    			td3 = element("td");
    			t10 = text(/*expiration_height*/ ctx[2]);
    			t11 = space();
    			hr = element("hr");
    			t12 = space();
    			div1 = element("div");
    			div0 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr_dev(h3, "class", "uk-text-muted uk-text-center uk-text-uppercase");
    			add_location(h3, file$6, 23, 4, 710);
    			attr_dev(td0, "class", "uk-text-uppercase");
    			add_location(td0, file$6, 29, 10, 871);
    			add_location(td1, file$6, 30, 10, 924);
    			add_location(tr0, file$6, 28, 8, 856);
    			attr_dev(td2, "class", "uk-text-uppercase");
    			add_location(td2, file$6, 33, 10, 999);
    			add_location(td3, file$6, 34, 10, 1056);
    			add_location(tr1, file$6, 32, 8, 984);
    			add_location(tbody, file$6, 27, 6, 840);
    			attr_dev(table, "class", "uk-table");
    			add_location(table, file$6, 26, 4, 809);
    			add_location(hr, file$6, 39, 4, 1134);
    			attr_dev(div0, "class", "uk-text-center");
    			add_location(div0, file$6, 42, 6, 1158);
    			add_location(div1, file$6, 41, 4, 1146);
    			add_location(div2, file$6, 22, 2, 700);
    			add_location(main, file$6, 21, 0, 691);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			append_dev(main, div2);
    			append_dev(div2, h3);
    			append_dev(div2, t1);
    			append_dev(div2, table);
    			append_dev(table, tbody);
    			append_dev(tbody, tr0);
    			append_dev(tr0, td0);
    			append_dev(tr0, t3);
    			append_dev(tr0, td1);
    			append_dev(td1, t4);
    			append_dev(td1, t5);
    			append_dev(td1, t6);
    			append_dev(tbody, t7);
    			append_dev(tbody, tr1);
    			append_dev(tr1, td2);
    			append_dev(tr1, t9);
    			append_dev(tr1, td3);
    			append_dev(td3, t10);
    			append_dev(div2, t11);
    			append_dev(div2, hr);
    			append_dev(div2, t12);
    			append_dev(div2, div1);
    			append_dev(div1, div0);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div0, null);
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*voters*/ 8) set_data_dev(t4, /*voters*/ ctx[3]);
    			if (dirty & /*validator_count*/ 2) set_data_dev(t6, /*validator_count*/ ctx[1]);
    			if (dirty & /*expiration_height*/ 4) set_data_dev(t10, /*expiration_height*/ ctx[2]);

    			if (dirty & /*vote_counts, validator_count*/ 3) {
    				each_value = /*vote_counts*/ ctx[0];
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$2(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block$2(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div0, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    			destroy_each(each_blocks, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$6.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$6($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('InProgress', slots, []);
    	let vote_counts = [];
    	let validator_count = 0;
    	let expiration_height = 0;
    	let voters = 0;
    	let vote_window_expired;
    	let current_height = 0;

    	chainInfo.subscribe(info_str => {
    		let data = JSON.parse(info_str);
    		$$invalidate(0, vote_counts = data.chain_view.upgrade.upgrade.vote_counts);
    		$$invalidate(3, voters = 0);

    		vote_counts.forEach(e => {
    			$$invalidate(3, voters = voters + e.validators.length);
    		});

    		$$invalidate(2, expiration_height = data.chain_view.upgrade.upgrade.vote_window);
    		vote_window_expired = expiration_height < current_height;
    		current_height = data.chain_view.height;
    		$$invalidate(1, validator_count = data.chain_view.validator_view.length);
    	});

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<InProgress> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({
    		chainInfo,
    		vote_counts,
    		validator_count,
    		expiration_height,
    		voters,
    		vote_window_expired,
    		current_height
    	});

    	$$self.$inject_state = $$props => {
    		if ('vote_counts' in $$props) $$invalidate(0, vote_counts = $$props.vote_counts);
    		if ('validator_count' in $$props) $$invalidate(1, validator_count = $$props.validator_count);
    		if ('expiration_height' in $$props) $$invalidate(2, expiration_height = $$props.expiration_height);
    		if ('voters' in $$props) $$invalidate(3, voters = $$props.voters);
    		if ('vote_window_expired' in $$props) vote_window_expired = $$props.vote_window_expired;
    		if ('current_height' in $$props) current_height = $$props.current_height;
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [vote_counts, validator_count, expiration_height, voters];
    }

    class InProgress extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$6, create_fragment$6, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "InProgress",
    			options,
    			id: create_fragment$6.name
    		});
    	}
    }

    /* src/components/upgrade/Upgrade.svelte generated by Svelte v3.44.2 */
    const file$5 = "src/components/upgrade/Upgrade.svelte";

    // (33:8) {:else}
    function create_else_block_1$2(ctx) {
    	let p;

    	const block = {
    		c: function create() {
    			p = element("p");
    			p.textContent = "loading...";
    			add_location(p, file$5, 33, 10, 1010);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, p, anchor);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(p);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block_1$2.name,
    		type: "else",
    		source: "(33:8) {:else}",
    		ctx
    	});

    	return block;
    }

    // (16:8) {#if data}
    function create_if_block$2(ctx) {
    	let current_block_type_index;
    	let if_block0;
    	let t;
    	let if_block1_anchor;
    	let current;
    	const if_block_creators = [create_if_block_2$2, create_else_block$2];
    	const if_blocks = [];

    	function select_block_type_1(ctx, dirty) {
    		if (/*vote_in_progress*/ ctx[1]) return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type_1(ctx);
    	if_block0 = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    	let if_block1 = /*vote_window_expired*/ ctx[2] && create_if_block_1$2(ctx);

    	const block = {
    		c: function create() {
    			if_block0.c();
    			t = space();
    			if (if_block1) if_block1.c();
    			if_block1_anchor = empty();
    		},
    		m: function mount(target, anchor) {
    			if_blocks[current_block_type_index].m(target, anchor);
    			insert_dev(target, t, anchor);
    			if (if_block1) if_block1.m(target, anchor);
    			insert_dev(target, if_block1_anchor, anchor);
    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type_1(ctx);

    			if (current_block_type_index !== previous_block_index) {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block0 = if_blocks[current_block_type_index];

    				if (!if_block0) {
    					if_block0 = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block0.c();
    				}

    				transition_in(if_block0, 1);
    				if_block0.m(t.parentNode, t);
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(if_block0);
    			transition_in(if_block1);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(if_block0);
    			transition_out(if_block1);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if_blocks[current_block_type_index].d(detaching);
    			if (detaching) detach_dev(t);
    			if (if_block1) if_block1.d(detaching);
    			if (detaching) detach_dev(if_block1_anchor);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$2.name,
    		type: "if",
    		source: "(16:8) {#if data}",
    		ctx
    	});

    	return block;
    }

    // (19:10) {:else}
    function create_else_block$2(ctx) {
    	let div;
    	let h4;

    	const block = {
    		c: function create() {
    			div = element("div");
    			h4 = element("h4");
    			h4.textContent = "No Current Upgrade Proposals";
    			attr_dev(h4, "class", "uk-text-uppercase uk-text-muted");
    			add_location(h4, file$5, 20, 14, 679);
    			attr_dev(div, "class", "uk-text-center");
    			add_location(div, file$5, 19, 12, 636);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, h4);
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block$2.name,
    		type: "else",
    		source: "(19:10) {:else}",
    		ctx
    	});

    	return block;
    }

    // (17:10) {#if vote_in_progress}
    function create_if_block_2$2(ctx) {
    	let inprogress;
    	let current;
    	inprogress = new InProgress({ $$inline: true });

    	const block = {
    		c: function create() {
    			create_component(inprogress.$$.fragment);
    		},
    		m: function mount(target, anchor) {
    			mount_component(inprogress, target, anchor);
    			current = true;
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(inprogress.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(inprogress.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(inprogress, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_2$2.name,
    		type: "if",
    		source: "(17:10) {#if vote_in_progress}",
    		ctx
    	});

    	return block;
    }

    // (27:10) {#if vote_window_expired}
    function create_if_block_1$2(ctx) {
    	let div;
    	let h3;
    	let t1;
    	let inprogress;
    	let current;
    	inprogress = new InProgress({ $$inline: true });

    	const block = {
    		c: function create() {
    			div = element("div");
    			h3 = element("h3");
    			h3.textContent = "Expired Proposals";
    			t1 = space();
    			create_component(inprogress.$$.fragment);
    			add_location(h3, file$5, 28, 14, 893);
    			add_location(div, file$5, 27, 12, 873);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, h3);
    			append_dev(div, t1);
    			mount_component(inprogress, div, null);
    			current = true;
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(inprogress.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(inprogress.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			destroy_component(inprogress);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_1$2.name,
    		type: "if",
    		source: "(27:10) {#if vote_window_expired}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$5(ctx) {
    	let main;
    	let div2;
    	let div1;
    	let div0;
    	let current_block_type_index;
    	let if_block;
    	let current;
    	const if_block_creators = [create_if_block$2, create_else_block_1$2];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*data*/ ctx[0]) return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	const block = {
    		c: function create() {
    			main = element("main");
    			div2 = element("div");
    			div1 = element("div");
    			div0 = element("div");
    			if_block.c();
    			attr_dev(div0, "class", "uk-card uk-card-default uk-card-body");
    			add_location(div0, file$5, 14, 6, 476);
    			attr_dev(div1, "class", "uk-grid-item-match");
    			add_location(div1, file$5, 13, 4, 437);
    			attr_dev(div2, "class", "uk-child-width-expand@s");
    			attr_dev(div2, "uk-grid", "");
    			add_location(div2, file$5, 12, 2, 387);
    			add_location(main, file$5, 11, 0, 378);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			append_dev(main, div2);
    			append_dev(div2, div1);
    			append_dev(div1, div0);
    			if_blocks[current_block_type_index].m(div0, null);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block = if_blocks[current_block_type_index];

    				if (!if_block) {
    					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block.c();
    				} else {
    					if_block.p(ctx, dirty);
    				}

    				transition_in(if_block, 1);
    				if_block.m(div0, null);
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    			if_blocks[current_block_type_index].d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$5.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$5($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Upgrade', slots, []);
    	let { data } = $$props;
    	let vote_in_progress = false;
    	let vote_window_expired = false;
    	const writable_props = ['data'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Upgrade> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ('data' in $$props) $$invalidate(0, data = $$props.data);
    	};

    	$$self.$capture_state = () => ({
    		InProgress,
    		data,
    		vote_in_progress,
    		vote_window_expired
    	});

    	$$self.$inject_state = $$props => {
    		if ('data' in $$props) $$invalidate(0, data = $$props.data);
    		if ('vote_in_progress' in $$props) $$invalidate(1, vote_in_progress = $$props.vote_in_progress);
    		if ('vote_window_expired' in $$props) $$invalidate(2, vote_window_expired = $$props.vote_window_expired);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*data*/ 1) {
    			if (data.chain_view && data.chain_view.upgrade) {
    				$$invalidate(1, vote_in_progress = data.chain_view.upgrade.upgrade.validators_voted.length > 0);
    			}
    		}
    	};

    	return [data, vote_in_progress, vote_window_expired];
    }

    class Upgrade extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$5, create_fragment$5, safe_not_equal, { data: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Upgrade",
    			options,
    			id: create_fragment$5.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*data*/ ctx[0] === undefined && !('data' in props)) {
    			console.warn("<Upgrade> was created without expected prop 'data'");
    		}
    	}

    	get data() {
    		throw new Error("<Upgrade>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set data(value) {
    		throw new Error("<Upgrade>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/watch-list/WatchList.svelte generated by Svelte v3.44.2 */
    const file$4 = "src/components/watch-list/WatchList.svelte";

    function get_each_context$1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[11] = list[i].note;
    	child_ctx[12] = list[i].address;
    	child_ctx[13] = list[i].balance;
    	child_ctx[14] = list[i].payers;
    	child_ctx[15] = list[i].average_percent;
    	child_ctx[16] = list[i].sum_percentage;
    	child_ctx[17] = list[i].all_percentage;
    	return child_ctx;
    }

    function get_each_context_1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[20] = list[i];
    	return child_ctx;
    }

    // (57:27) {#if !has_notes}
    function create_if_block_6(ctx) {
    	let addressnotetip;
    	let current;
    	addressnotetip = new AddressNoteTip({ $$inline: true });

    	const block = {
    		c: function create() {
    			create_component(addressnotetip.$$.fragment);
    		},
    		m: function mount(target, anchor) {
    			mount_component(addressnotetip, target, anchor);
    			current = true;
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(addressnotetip.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(addressnotetip.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(addressnotetip, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_6.name,
    		type: "if",
    		source: "(57:27) {#if !has_notes}",
    		ctx
    	});

    	return block;
    }

    // (59:4) {#if watch_list}
    function create_if_block$1(ctx) {
    	let div;
    	let table;
    	let thead;
    	let tr0;
    	let t0;
    	let tbody;
    	let t1;
    	let tr1;
    	let td0;
    	let t3;
    	let t4;
    	let td1;
    	let t5;
    	let td2;
    	let t6;
    	let td3;
    	let t7_value = formatBalance(/*total_balance*/ ctx[3]) + "";
    	let t7;
    	let t8;
    	let td4;
    	let t9_value = formatPercent(/*total_sum_percentage*/ ctx[4]) + "";
    	let t9;
    	let t10;
    	let td5;
    	let t11_value = formatPercent(/*total_percentage*/ ctx[5]) + "";
    	let t11;
    	let each_value_1 = /*sortableColumns*/ ctx[7];
    	validate_each_argument(each_value_1);
    	let each_blocks_1 = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks_1[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
    	}

    	let each_value = /*watch_list*/ ctx[2];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$1(get_each_context$1(ctx, each_value, i));
    	}

    	let if_block = /*has_notes*/ ctx[6] && create_if_block_1$1(ctx);

    	const block = {
    		c: function create() {
    			div = element("div");
    			table = element("table");
    			thead = element("thead");
    			tr0 = element("tr");

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].c();
    			}

    			t0 = space();
    			tbody = element("tbody");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t1 = space();
    			tr1 = element("tr");
    			td0 = element("td");
    			td0.textContent = "TOTAL";
    			t3 = space();
    			if (if_block) if_block.c();
    			t4 = space();
    			td1 = element("td");
    			t5 = space();
    			td2 = element("td");
    			t6 = space();
    			td3 = element("td");
    			t7 = text(t7_value);
    			t8 = space();
    			td4 = element("td");
    			t9 = text(t9_value);
    			t10 = space();
    			td5 = element("td");
    			t11 = text(t11_value);
    			add_location(tr0, file$4, 62, 20, 2039);
    			add_location(thead, file$4, 61, 16, 2011);
    			attr_dev(td0, "class", "uk-text-center uk-text-bold");
    			add_location(td0, file$4, 98, 24, 4117);
    			add_location(td1, file$4, 102, 24, 4300);
    			add_location(td2, file$4, 103, 24, 4334);
    			attr_dev(td3, "class", "uk-text-right uk-text-bold");
    			add_location(td3, file$4, 104, 24, 4368);
    			attr_dev(td4, "class", "uk-text-right uk-text-bold");
    			add_location(td4, file$4, 105, 24, 4467);
    			attr_dev(td5, "class", "uk-text-right uk-text-bold");
    			add_location(td5, file$4, 106, 24, 4573);
    			add_location(tr1, file$4, 97, 20, 4088);
    			add_location(tbody, file$4, 81, 16, 3009);
    			attr_dev(table, "class", "uk-table uk-table-hover");
    			add_location(table, file$4, 60, 12, 1955);
    			attr_dev(div, "class", "uk-overflow-auto");
    			add_location(div, file$4, 59, 8, 1912);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, table);
    			append_dev(table, thead);
    			append_dev(thead, tr0);

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].m(tr0, null);
    			}

    			append_dev(table, t0);
    			append_dev(table, tbody);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(tbody, null);
    			}

    			append_dev(tbody, t1);
    			append_dev(tbody, tr1);
    			append_dev(tr1, td0);
    			append_dev(tr1, t3);
    			if (if_block) if_block.m(tr1, null);
    			append_dev(tr1, t4);
    			append_dev(tr1, td1);
    			append_dev(tr1, t5);
    			append_dev(tr1, td2);
    			append_dev(tr1, t6);
    			append_dev(tr1, td3);
    			append_dev(td3, t7);
    			append_dev(tr1, t8);
    			append_dev(tr1, td4);
    			append_dev(td4, t9);
    			append_dev(tr1, t10);
    			append_dev(tr1, td5);
    			append_dev(td5, t11);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*sortableColumns, has_notes, thOnClick, sortOrder, sortOption*/ 451) {
    				each_value_1 = /*sortableColumns*/ ctx[7];
    				validate_each_argument(each_value_1);
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1(ctx, each_value_1, i);

    					if (each_blocks_1[i]) {
    						each_blocks_1[i].p(child_ctx, dirty);
    					} else {
    						each_blocks_1[i] = create_each_block_1(child_ctx);
    						each_blocks_1[i].c();
    						each_blocks_1[i].m(tr0, null);
    					}
    				}

    				for (; i < each_blocks_1.length; i += 1) {
    					each_blocks_1[i].d(1);
    				}

    				each_blocks_1.length = each_value_1.length;
    			}

    			if (dirty & /*formatPercent, watch_list, formatBalance, has_notes*/ 68) {
    				each_value = /*watch_list*/ ctx[2];
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$1(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block$1(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(tbody, t1);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (/*has_notes*/ ctx[6]) {
    				if (if_block) ; else {
    					if_block = create_if_block_1$1(ctx);
    					if_block.c();
    					if_block.m(tr1, t4);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (dirty & /*total_balance*/ 8 && t7_value !== (t7_value = formatBalance(/*total_balance*/ ctx[3]) + "")) set_data_dev(t7, t7_value);
    			if (dirty & /*total_sum_percentage*/ 16 && t9_value !== (t9_value = formatPercent(/*total_sum_percentage*/ ctx[4]) + "")) set_data_dev(t9, t9_value);
    			if (dirty & /*total_percentage*/ 32 && t11_value !== (t11_value = formatPercent(/*total_percentage*/ ctx[5]) + "")) set_data_dev(t11, t11_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			destroy_each(each_blocks_1, detaching);
    			destroy_each(each_blocks, detaching);
    			if (if_block) if_block.d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$1.name,
    		type: "if",
    		source: "(59:4) {#if watch_list}",
    		ctx
    	});

    	return block;
    }

    // (67:28) {:else}
    function create_else_block$1(ctx) {
    	let th;
    	let span;
    	let t0_value = /*col*/ ctx[20].label + "";
    	let t0;
    	let t1;
    	let t2;
    	let mounted;
    	let dispose;
    	let if_block = /*sortOption*/ ctx[0] == /*col*/ ctx[20].sortKey && create_if_block_4(ctx);

    	function click_handler() {
    		return /*click_handler*/ ctx[10](/*col*/ ctx[20]);
    	}

    	const block = {
    		c: function create() {
    			th = element("th");
    			span = element("span");
    			t0 = text(t0_value);
    			t1 = space();
    			if (if_block) if_block.c();
    			t2 = space();
    			attr_dev(span, "class", "disable-select");
    			add_location(span, file$4, 68, 32, 2379);
    			attr_dev(th, "class", "uk-text-center");
    			add_location(th, file$4, 67, 32, 2279);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, th, anchor);
    			append_dev(th, span);
    			append_dev(span, t0);
    			append_dev(th, t1);
    			if (if_block) if_block.m(th, null);
    			append_dev(th, t2);

    			if (!mounted) {
    				dispose = listen_dev(th, "click", click_handler, false, false, false);
    				mounted = true;
    			}
    		},
    		p: function update(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (/*sortOption*/ ctx[0] == /*col*/ ctx[20].sortKey) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_4(ctx);
    					if_block.c();
    					if_block.m(th, t2);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(th);
    			if (if_block) if_block.d();
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block$1.name,
    		type: "else",
    		source: "(67:28) {:else}",
    		ctx
    	});

    	return block;
    }

    // (65:28) {#if col.label == "note" && !has_notes}
    function create_if_block_3$1(ctx) {
    	const block = { c: noop, m: noop, p: noop, d: noop };

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_3$1.name,
    		type: "if",
    		source: "(65:28) {#if col.label == \\\"note\\\" && !has_notes}",
    		ctx
    	});

    	return block;
    }

    // (70:32) {#if sortOption == col.sortKey}
    function create_if_block_4(ctx) {
    	let if_block_anchor;

    	function select_block_type_1(ctx, dirty) {
    		if (/*sortOrder*/ ctx[1] == 1) return create_if_block_5;
    		return create_else_block_1$1;
    	}

    	let current_block_type = select_block_type_1(ctx);
    	let if_block = current_block_type(ctx);

    	const block = {
    		c: function create() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		m: function mount(target, anchor) {
    			if_block.m(target, anchor);
    			insert_dev(target, if_block_anchor, anchor);
    		},
    		p: function update(ctx, dirty) {
    			if (current_block_type !== (current_block_type = select_block_type_1(ctx))) {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			}
    		},
    		d: function destroy(detaching) {
    			if_block.d(detaching);
    			if (detaching) detach_dev(if_block_anchor);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_4.name,
    		type: "if",
    		source: "(70:32) {#if sortOption == col.sortKey}",
    		ctx
    	});

    	return block;
    }

    // (73:36) {:else}
    function create_else_block_1$1(ctx) {
    	let span;

    	const block = {
    		c: function create() {
    			span = element("span");
    			attr_dev(span, "uk-icon", "icon: triangle-down");
    			add_location(span, file$4, 73, 40, 2714);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, span, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(span);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block_1$1.name,
    		type: "else",
    		source: "(73:36) {:else}",
    		ctx
    	});

    	return block;
    }

    // (71:36) {#if sortOrder == 1}
    function create_if_block_5(ctx) {
    	let span;

    	const block = {
    		c: function create() {
    			span = element("span");
    			attr_dev(span, "uk-icon", "icon: triangle-up");
    			add_location(span, file$4, 71, 40, 2588);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, span, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(span);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_5.name,
    		type: "if",
    		source: "(71:36) {#if sortOrder == 1}",
    		ctx
    	});

    	return block;
    }

    // (64:24) {#each sortableColumns as col}
    function create_each_block_1(ctx) {
    	let if_block_anchor;

    	function select_block_type(ctx, dirty) {
    		if (/*col*/ ctx[20].label == "note" && !/*has_notes*/ ctx[6]) return create_if_block_3$1;
    		return create_else_block$1;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block = current_block_type(ctx);

    	const block = {
    		c: function create() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		m: function mount(target, anchor) {
    			if_block.m(target, anchor);
    			insert_dev(target, if_block_anchor, anchor);
    		},
    		p: function update(ctx, dirty) {
    			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			}
    		},
    		d: function destroy(detaching) {
    			if_block.d(detaching);
    			if (detaching) detach_dev(if_block_anchor);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block_1.name,
    		type: "each",
    		source: "(64:24) {#each sortableColumns as col}",
    		ctx
    	});

    	return block;
    }

    // (85:28) {#if has_notes}
    function create_if_block_2$1(ctx) {
    	let td0;
    	let t0_value = /*note*/ ctx[11] + "";
    	let t0;
    	let t1;
    	let td1;
    	let t2_value = /*note*/ ctx[11] + "";
    	let t2;

    	const block = {
    		c: function create() {
    			td0 = element("td");
    			t0 = text(t0_value);
    			t1 = space();
    			td1 = element("td");
    			t2 = text(t2_value);
    			attr_dev(td0, "class", "uk-visible@s uk-text-center");
    			add_location(td0, file$4, 85, 32, 3246);
    			attr_dev(td1, "class", "uk-hidden@s uk-text-truncate");
    			add_location(td1, file$4, 86, 32, 3330);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, td0, anchor);
    			append_dev(td0, t0);
    			insert_dev(target, t1, anchor);
    			insert_dev(target, td1, anchor);
    			append_dev(td1, t2);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*watch_list*/ 4 && t0_value !== (t0_value = /*note*/ ctx[11] + "")) set_data_dev(t0, t0_value);
    			if (dirty & /*watch_list*/ 4 && t2_value !== (t2_value = /*note*/ ctx[11] + "")) set_data_dev(t2, t2_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(td0);
    			if (detaching) detach_dev(t1);
    			if (detaching) detach_dev(td1);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_2$1.name,
    		type: "if",
    		source: "(85:28) {#if has_notes}",
    		ctx
    	});

    	return block;
    }

    // (83:20) {#each watch_list as {note, address, balance, payers, average_percent, sum_percentage, all_percentage}}
    function create_each_block$1(ctx) {
    	let tr;
    	let t0;
    	let td0;
    	let t1_value = /*address*/ ctx[12] + "";
    	let t1;
    	let t2;
    	let td1;
    	let t3_value = /*address*/ ctx[12] + "";
    	let t3;
    	let t4;
    	let td2;
    	let t5_value = /*payers*/ ctx[14] + "";
    	let t5;
    	let t6;
    	let td3;
    	let t7_value = formatPercent(/*average_percent*/ ctx[15]) + "";
    	let t7;
    	let t8;
    	let td4;
    	let t9_value = formatBalance(/*balance*/ ctx[13]) + "";
    	let t9;
    	let t10;
    	let td5;
    	let t11_value = formatPercent(/*sum_percentage*/ ctx[16]) + "";
    	let t11;
    	let t12;
    	let td6;
    	let t13_value = formatPercent(/*all_percentage*/ ctx[17]) + "";
    	let t13;
    	let if_block = /*has_notes*/ ctx[6] && create_if_block_2$1(ctx);

    	const block = {
    		c: function create() {
    			tr = element("tr");
    			if (if_block) if_block.c();
    			t0 = space();
    			td0 = element("td");
    			t1 = text(t1_value);
    			t2 = space();
    			td1 = element("td");
    			t3 = text(t3_value);
    			t4 = space();
    			td2 = element("td");
    			t5 = text(t5_value);
    			t6 = space();
    			td3 = element("td");
    			t7 = text(t7_value);
    			t8 = space();
    			td4 = element("td");
    			t9 = text(t9_value);
    			t10 = space();
    			td5 = element("td");
    			t11 = text(t11_value);
    			t12 = space();
    			td6 = element("td");
    			t13 = text(t13_value);
    			attr_dev(td0, "class", "uk-visible@s uk-text-center");
    			add_location(td0, file$4, 88, 28, 3445);
    			attr_dev(td1, "class", "uk-hidden@s uk-text-truncate");
    			add_location(td1, file$4, 89, 28, 3528);
    			attr_dev(td2, "class", "uk-text-right");
    			add_location(td2, file$4, 90, 28, 3612);
    			attr_dev(td3, "class", "uk-text-right");
    			add_location(td3, file$4, 91, 28, 3680);
    			attr_dev(td4, "class", "uk-text-right");
    			add_location(td4, file$4, 92, 28, 3772);
    			attr_dev(td5, "class", "uk-text-right");
    			add_location(td5, file$4, 93, 28, 3856);
    			attr_dev(td6, "class", "uk-text-right");
    			add_location(td6, file$4, 94, 28, 3947);
    			add_location(tr, file$4, 83, 24, 3165);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, tr, anchor);
    			if (if_block) if_block.m(tr, null);
    			append_dev(tr, t0);
    			append_dev(tr, td0);
    			append_dev(td0, t1);
    			append_dev(tr, t2);
    			append_dev(tr, td1);
    			append_dev(td1, t3);
    			append_dev(tr, t4);
    			append_dev(tr, td2);
    			append_dev(td2, t5);
    			append_dev(tr, t6);
    			append_dev(tr, td3);
    			append_dev(td3, t7);
    			append_dev(tr, t8);
    			append_dev(tr, td4);
    			append_dev(td4, t9);
    			append_dev(tr, t10);
    			append_dev(tr, td5);
    			append_dev(td5, t11);
    			append_dev(tr, t12);
    			append_dev(tr, td6);
    			append_dev(td6, t13);
    		},
    		p: function update(ctx, dirty) {
    			if (/*has_notes*/ ctx[6]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_2$1(ctx);
    					if_block.c();
    					if_block.m(tr, t0);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (dirty & /*watch_list*/ 4 && t1_value !== (t1_value = /*address*/ ctx[12] + "")) set_data_dev(t1, t1_value);
    			if (dirty & /*watch_list*/ 4 && t3_value !== (t3_value = /*address*/ ctx[12] + "")) set_data_dev(t3, t3_value);
    			if (dirty & /*watch_list*/ 4 && t5_value !== (t5_value = /*payers*/ ctx[14] + "")) set_data_dev(t5, t5_value);
    			if (dirty & /*watch_list*/ 4 && t7_value !== (t7_value = formatPercent(/*average_percent*/ ctx[15]) + "")) set_data_dev(t7, t7_value);
    			if (dirty & /*watch_list*/ 4 && t9_value !== (t9_value = formatBalance(/*balance*/ ctx[13]) + "")) set_data_dev(t9, t9_value);
    			if (dirty & /*watch_list*/ 4 && t11_value !== (t11_value = formatPercent(/*sum_percentage*/ ctx[16]) + "")) set_data_dev(t11, t11_value);
    			if (dirty & /*watch_list*/ 4 && t13_value !== (t13_value = formatPercent(/*all_percentage*/ ctx[17]) + "")) set_data_dev(t13, t13_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(tr);
    			if (if_block) if_block.d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block$1.name,
    		type: "each",
    		source: "(83:20) {#each watch_list as {note, address, balance, payers, average_percent, sum_percentage, all_percentage}}",
    		ctx
    	});

    	return block;
    }

    // (100:24) {#if has_notes}
    function create_if_block_1$1(ctx) {
    	let td;

    	const block = {
    		c: function create() {
    			td = element("td");
    			add_location(td, file$4, 100, 28, 4236);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, td, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(td);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_1$1.name,
    		type: "if",
    		source: "(100:24) {#if has_notes}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$4(ctx) {
    	let div;
    	let h2;
    	let t0;
    	let t1;
    	let current;
    	let if_block0 = !/*has_notes*/ ctx[6] && create_if_block_6(ctx);
    	let if_block1 = /*watch_list*/ ctx[2] && create_if_block$1(ctx);

    	const block = {
    		c: function create() {
    			div = element("div");
    			h2 = element("h2");
    			t0 = text("Autopay Watch List ");
    			if (if_block0) if_block0.c();
    			t1 = space();
    			if (if_block1) if_block1.c();
    			attr_dev(h2, "class", "uk-text-center uk-text-uppercase uk-text-muted uk-text-light uk-margin-medium-bottom");
    			add_location(h2, file$4, 55, 4, 1708);
    			add_location(div, file$4, 54, 0, 1698);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, h2);
    			append_dev(h2, t0);
    			if (if_block0) if_block0.m(h2, null);
    			append_dev(div, t1);
    			if (if_block1) if_block1.m(div, null);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			if (!/*has_notes*/ ctx[6]) {
    				if (if_block0) {
    					if (dirty & /*has_notes*/ 64) {
    						transition_in(if_block0, 1);
    					}
    				} else {
    					if_block0 = create_if_block_6(ctx);
    					if_block0.c();
    					transition_in(if_block0, 1);
    					if_block0.m(h2, null);
    				}
    			} else if (if_block0) {
    				group_outros();

    				transition_out(if_block0, 1, 1, () => {
    					if_block0 = null;
    				});

    				check_outros();
    			}

    			if (/*watch_list*/ ctx[2]) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);
    				} else {
    					if_block1 = create_if_block$1(ctx);
    					if_block1.c();
    					if_block1.m(div, null);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(if_block0);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(if_block0);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			if (if_block0) if_block0.d();
    			if (if_block1) if_block1.d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$4.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function formatBalance(balance) {
    	return balance.toLocaleString('en-ES', {
    		minimumFractionDigits: 0,
    		maximumFractionDigits: 0
    	});
    }

    function formatPercent(num) {
    	return (num / 100).toFixed(2) + "%";
    }

    function instance$4($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('WatchList', slots, []);
    	let { data } = $$props;

    	let sortableColumns = [
    		{ label: "note", sortKey: "note" },
    		{ label: "address", sortKey: "address" },
    		{ label: "#payers", sortKey: "payers" },
    		{
    			label: "average %",
    			sortKey: "average_percent"
    		},
    		{ label: "balance", sortKey: "balance" },
    		{
    			label: "sum %",
    			sortKey: "sum_percentage"
    		},
    		{
    			label: "% of all",
    			sortKey: "all_percentage"
    		}
    	];

    	let sortOption = "payers";
    	let sortOrder = -1;
    	let total_balance, total_sum_percentage, total_percentage;
    	let has_notes = false;
    	let watch_list = null;

    	function thOnClick(key) {
    		if (sortOption == key) {
    			$$invalidate(1, sortOrder = -sortOrder);
    		}

    		$$invalidate(0, sortOption = key);
    	}

    	const writable_props = ['data'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<WatchList> was created with unknown prop '${key}'`);
    	});

    	const click_handler = col => thOnClick(col.sortKey);

    	$$self.$$set = $$props => {
    		if ('data' in $$props) $$invalidate(9, data = $$props.data);
    	};

    	$$self.$capture_state = () => ({
    		AddressNoteTip,
    		data,
    		sortableColumns,
    		sortOption,
    		sortOrder,
    		total_balance,
    		total_sum_percentage,
    		total_percentage,
    		has_notes,
    		watch_list,
    		thOnClick,
    		formatBalance,
    		formatPercent
    	});

    	$$self.$inject_state = $$props => {
    		if ('data' in $$props) $$invalidate(9, data = $$props.data);
    		if ('sortableColumns' in $$props) $$invalidate(7, sortableColumns = $$props.sortableColumns);
    		if ('sortOption' in $$props) $$invalidate(0, sortOption = $$props.sortOption);
    		if ('sortOrder' in $$props) $$invalidate(1, sortOrder = $$props.sortOrder);
    		if ('total_balance' in $$props) $$invalidate(3, total_balance = $$props.total_balance);
    		if ('total_sum_percentage' in $$props) $$invalidate(4, total_sum_percentage = $$props.total_sum_percentage);
    		if ('total_percentage' in $$props) $$invalidate(5, total_percentage = $$props.total_percentage);
    		if ('has_notes' in $$props) $$invalidate(6, has_notes = $$props.has_notes);
    		if ('watch_list' in $$props) $$invalidate(2, watch_list = $$props.watch_list);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*data, sortOption, sortOrder, watch_list, total_balance, total_percentage, total_sum_percentage*/ 575) {
    			if (data && data.chain_view && data.chain_view.autopay_watch_list) {
    				$$invalidate(2, watch_list = data.chain_view.autopay_watch_list.sort((a, b) => a[sortOption] > b[sortOption] ? sortOrder : -sortOrder));
    				$$invalidate(6, has_notes = watch_list.some(e => e.note != ""));

    				// update totals
    				$$invalidate(3, total_balance = 0);

    				$$invalidate(5, total_percentage = 0);
    				$$invalidate(4, total_sum_percentage = 0);

    				watch_list.forEach(stat => {
    					$$invalidate(3, total_balance += stat.balance);
    					$$invalidate(5, total_percentage += stat.all_percentage);
    					$$invalidate(4, total_sum_percentage += stat.sum_percentage);
    				});
    			}
    		}
    	};

    	return [
    		sortOption,
    		sortOrder,
    		watch_list,
    		total_balance,
    		total_sum_percentage,
    		total_percentage,
    		has_notes,
    		sortableColumns,
    		thOnClick,
    		data,
    		click_handler
    	];
    }

    class WatchList extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$4, create_fragment$4, safe_not_equal, { data: 9 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "WatchList",
    			options,
    			id: create_fragment$4.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*data*/ ctx[9] === undefined && !('data' in props)) {
    			console.warn("<WatchList> was created without expected prop 'data'");
    		}
    	}

    	get data() {
    		throw new Error("<WatchList>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set data(value) {
    		throw new Error("<WatchList>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/audit/AuditSummary.svelte generated by Svelte v3.44.2 */

    const file$3 = "src/components/audit/AuditSummary.svelte";

    function create_fragment$3(ctx) {
    	let div;
    	let table;
    	let thead;
    	let tr0;
    	let th0;
    	let t1;
    	let th1;
    	let t3;
    	let th2;
    	let t5;
    	let tbody;
    	let tr1;
    	let td0;
    	let t7;
    	let td1;
    	let t8_value = /*stats*/ ctx[0].count_vals_with_autopay + "";
    	let t8;
    	let t9;
    	let td2;
    	let t10_value = print_percent(/*stats*/ ctx[0].percent_vals_with_autopay) + "";
    	let t10;
    	let t11;
    	let tr2;
    	let td3;
    	let t13;
    	let td4;
    	let t14_value = /*stats*/ ctx[0].count_vals_with_operator + "";
    	let t14;
    	let t15;
    	let td5;
    	let t16_value = print_percent(/*stats*/ ctx[0].percent_vals_with_operator) + "";
    	let t16;
    	let t17;
    	let tr3;
    	let td6;
    	let t19;
    	let td7;
    	let t20_value = /*stats*/ ctx[0].count_positive_balance_operators + "";
    	let t20;
    	let t21;
    	let td8;
    	let t22_value = print_percent(/*stats*/ ctx[0].percent_positive_balance_operators) + "";
    	let t22;

    	const block = {
    		c: function create() {
    			div = element("div");
    			table = element("table");
    			thead = element("thead");
    			tr0 = element("tr");
    			th0 = element("th");
    			th0.textContent = "check";
    			t1 = space();
    			th1 = element("th");
    			th1.textContent = "#vals";
    			t3 = space();
    			th2 = element("th");
    			th2.textContent = "%vals";
    			t5 = space();
    			tbody = element("tbody");
    			tr1 = element("tr");
    			td0 = element("td");
    			td0.textContent = "Has Recurring Autopay";
    			t7 = space();
    			td1 = element("td");
    			t8 = text(t8_value);
    			t9 = space();
    			td2 = element("td");
    			t10 = text(t10_value);
    			t11 = space();
    			tr2 = element("tr");
    			td3 = element("td");
    			td3.textContent = "Has Operator Account";
    			t13 = space();
    			td4 = element("td");
    			t14 = text(t14_value);
    			t15 = space();
    			td5 = element("td");
    			t16 = text(t16_value);
    			t17 = space();
    			tr3 = element("tr");
    			td6 = element("td");
    			td6.textContent = "Has Operator Positive Balance";
    			t19 = space();
    			td7 = element("td");
    			t20 = text(t20_value);
    			t21 = space();
    			td8 = element("td");
    			t22 = text(t22_value);
    			attr_dev(th0, "class", "uk-text-left");
    			add_location(th0, file$3, 18, 16, 384);
    			attr_dev(th1, "class", "uk-text-center");
    			add_location(th1, file$3, 19, 16, 436);
    			attr_dev(th2, "class", "uk-text-center");
    			add_location(th2, file$3, 20, 16, 490);
    			add_location(tr0, file$3, 17, 12, 363);
    			add_location(thead, file$3, 16, 8, 343);
    			add_location(td0, file$3, 25, 16, 612);
    			attr_dev(td1, "class", "uk-text-right");
    			add_location(td1, file$3, 26, 16, 659);
    			attr_dev(td2, "class", "uk-text-right");
    			add_location(td2, file$3, 27, 16, 738);
    			add_location(tr1, file$3, 24, 12, 591);
    			add_location(td3, file$3, 30, 16, 869);
    			attr_dev(td4, "class", "uk-text-right");
    			add_location(td4, file$3, 31, 16, 915);
    			attr_dev(td5, "class", "uk-text-right");
    			add_location(td5, file$3, 32, 16, 995);
    			add_location(tr2, file$3, 29, 12, 848);
    			add_location(td6, file$3, 35, 16, 1127);
    			attr_dev(td7, "class", "uk-text-right");
    			add_location(td7, file$3, 36, 16, 1182);
    			attr_dev(td8, "class", "uk-text-right");
    			add_location(td8, file$3, 37, 16, 1270);
    			add_location(tr3, file$3, 34, 12, 1106);
    			add_location(tbody, file$3, 23, 8, 571);
    			attr_dev(table, "class", "uk-table");
    			add_location(table, file$3, 15, 4, 310);
    			attr_dev(div, "class", "uk-card uk-card-default uk-card-body uk-margin-bottom audit-container svelte-vi7vi7");
    			add_location(div, file$3, 14, 0, 222);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, table);
    			append_dev(table, thead);
    			append_dev(thead, tr0);
    			append_dev(tr0, th0);
    			append_dev(tr0, t1);
    			append_dev(tr0, th1);
    			append_dev(tr0, t3);
    			append_dev(tr0, th2);
    			append_dev(table, t5);
    			append_dev(table, tbody);
    			append_dev(tbody, tr1);
    			append_dev(tr1, td0);
    			append_dev(tr1, t7);
    			append_dev(tr1, td1);
    			append_dev(td1, t8);
    			append_dev(tr1, t9);
    			append_dev(tr1, td2);
    			append_dev(td2, t10);
    			append_dev(tbody, t11);
    			append_dev(tbody, tr2);
    			append_dev(tr2, td3);
    			append_dev(tr2, t13);
    			append_dev(tr2, td4);
    			append_dev(td4, t14);
    			append_dev(tr2, t15);
    			append_dev(tr2, td5);
    			append_dev(td5, t16);
    			append_dev(tbody, t17);
    			append_dev(tbody, tr3);
    			append_dev(tr3, td6);
    			append_dev(tr3, t19);
    			append_dev(tr3, td7);
    			append_dev(td7, t20);
    			append_dev(tr3, t21);
    			append_dev(tr3, td8);
    			append_dev(td8, t22);
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*stats*/ 1 && t8_value !== (t8_value = /*stats*/ ctx[0].count_vals_with_autopay + "")) set_data_dev(t8, t8_value);
    			if (dirty & /*stats*/ 1 && t10_value !== (t10_value = print_percent(/*stats*/ ctx[0].percent_vals_with_autopay) + "")) set_data_dev(t10, t10_value);
    			if (dirty & /*stats*/ 1 && t14_value !== (t14_value = /*stats*/ ctx[0].count_vals_with_operator + "")) set_data_dev(t14, t14_value);
    			if (dirty & /*stats*/ 1 && t16_value !== (t16_value = print_percent(/*stats*/ ctx[0].percent_vals_with_operator) + "")) set_data_dev(t16, t16_value);
    			if (dirty & /*stats*/ 1 && t20_value !== (t20_value = /*stats*/ ctx[0].count_positive_balance_operators + "")) set_data_dev(t20, t20_value);
    			if (dirty & /*stats*/ 1 && t22_value !== (t22_value = print_percent(/*stats*/ ctx[0].percent_positive_balance_operators) + "")) set_data_dev(t22, t22_value);
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$3.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function print_percent(num) {
    	return (num * 100).toFixed(0) + "%";
    }

    function instance$3($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('AuditSummary', slots, []);
    	let { stats } = $$props;
    	const writable_props = ['stats'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<AuditSummary> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ('stats' in $$props) $$invalidate(0, stats = $$props.stats);
    	};

    	$$self.$capture_state = () => ({ stats, print_percent });

    	$$self.$inject_state = $$props => {
    		if ('stats' in $$props) $$invalidate(0, stats = $$props.stats);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [stats];
    }

    class AuditSummary extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$3, create_fragment$3, safe_not_equal, { stats: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "AuditSummary",
    			options,
    			id: create_fragment$3.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*stats*/ ctx[0] === undefined && !('stats' in props)) {
    			console.warn("<AuditSummary> was created without expected prop 'stats'");
    		}
    	}

    	get stats() {
    		throw new Error("<AuditSummary>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set stats(value) {
    		throw new Error("<AuditSummary>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/audit/AuditVals.svelte generated by Svelte v3.44.2 */
    const file$2 = "src/components/audit/AuditVals.svelte";

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[4] = list[i];
    	return child_ctx;
    }

    // (81:4) {:else}
    function create_else_block_3(ctx) {
    	let t;

    	const block = {
    		c: function create() {
    			t = text("loading...");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, t, anchor);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(t);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block_3.name,
    		type: "else",
    		source: "(81:4) {:else}",
    		ctx
    	});

    	return block;
    }

    // (34:4) {#if data.chain_view}
    function create_if_block(ctx) {
    	let auditsummary;
    	let t0;
    	let div;
    	let table;
    	let thead;
    	let tr;
    	let th0;
    	let t2;
    	let th1;
    	let t4;
    	let th2;
    	let t6;
    	let th3;
    	let t7;
    	let br;
    	let t8;
    	let t9;
    	let th4;
    	let t10;
    	let tbody;
    	let current;

    	auditsummary = new AuditSummary({
    			props: {
    				stats: /*data*/ ctx[0].chain_view.vals_config_stats
    			},
    			$$inline: true
    		});

    	let each_value = /*audit_set*/ ctx[1];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	const block = {
    		c: function create() {
    			create_component(auditsummary.$$.fragment);
    			t0 = space();
    			div = element("div");
    			table = element("table");
    			thead = element("thead");
    			tr = element("tr");
    			th0 = element("th");
    			th0.textContent = "Validator";
    			t2 = space();
    			th1 = element("th");
    			th1.textContent = "Recurring Autopay";
    			t4 = space();
    			th2 = element("th");
    			th2.textContent = "Operator Account";
    			t6 = space();
    			th3 = element("th");
    			t7 = text("Operator Has");
    			br = element("br");
    			t8 = text("Positive Balance");
    			t9 = space();
    			th4 = element("th");
    			t10 = space();
    			tbody = element("tbody");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr_dev(th0, "class", "uk-text-center");
    			add_location(th0, file$2, 39, 24, 1425);
    			attr_dev(th1, "class", "uk-text-center");
    			add_location(th1, file$2, 40, 24, 1491);
    			attr_dev(th2, "class", "uk-text-center");
    			add_location(th2, file$2, 41, 24, 1565);
    			add_location(br, file$2, 42, 63, 1677);
    			attr_dev(th3, "class", "uk-text-center");
    			add_location(th3, file$2, 42, 24, 1638);
    			attr_dev(th4, "class", "uk-text-center");
    			add_location(th4, file$2, 43, 24, 1727);
    			add_location(tr, file$2, 38, 20, 1396);
    			add_location(thead, file$2, 37, 16, 1368);
    			add_location(tbody, file$2, 46, 16, 1827);
    			attr_dev(table, "class", "uk-table uk-table-hover");
    			add_location(table, file$2, 36, 12, 1312);
    			attr_dev(div, "class", "uk-overflow-auto");
    			add_location(div, file$2, 35, 8, 1269);
    		},
    		m: function mount(target, anchor) {
    			mount_component(auditsummary, target, anchor);
    			insert_dev(target, t0, anchor);
    			insert_dev(target, div, anchor);
    			append_dev(div, table);
    			append_dev(table, thead);
    			append_dev(thead, tr);
    			append_dev(tr, th0);
    			append_dev(tr, t2);
    			append_dev(tr, th1);
    			append_dev(tr, t4);
    			append_dev(tr, th2);
    			append_dev(tr, t6);
    			append_dev(tr, th3);
    			append_dev(th3, t7);
    			append_dev(th3, br);
    			append_dev(th3, t8);
    			append_dev(tr, t9);
    			append_dev(tr, th4);
    			append_dev(table, t10);
    			append_dev(table, tbody);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(tbody, null);
    			}

    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			const auditsummary_changes = {};
    			if (dirty & /*data*/ 1) auditsummary_changes.stats = /*data*/ ctx[0].chain_view.vals_config_stats;
    			auditsummary.$set(auditsummary_changes);

    			if (dirty & /*selected_val, audit_set, modal_id*/ 6) {
    				each_value = /*audit_set*/ ctx[1];
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(tbody, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(auditsummary.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(auditsummary.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(auditsummary, detaching);
    			if (detaching) detach_dev(t0);
    			if (detaching) detach_dev(div);
    			destroy_each(each_blocks, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block.name,
    		type: "if",
    		source: "(34:4) {#if data.chain_view}",
    		ctx
    	});

    	return block;
    }

    // (55:32) {:else}
    function create_else_block_2(ctx) {
    	let span;

    	const block = {
    		c: function create() {
    			span = element("span");
    			attr_dev(span, "class", "uk-text-danger");
    			attr_dev(span, "uk-icon", "icon: close");
    			add_location(span, file$2, 55, 36, 2427);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, span, anchor);
    		},
    		p: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(span);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block_2.name,
    		type: "else",
    		source: "(55:32) {:else}",
    		ctx
    	});

    	return block;
    }

    // (53:32) {#if val.has_autopay}
    function create_if_block_3(ctx) {
    	let span;
    	let t0;
    	let t1_value = /*val*/ ctx[4].recurring_sum + "";
    	let t1;

    	const block = {
    		c: function create() {
    			span = element("span");
    			t0 = space();
    			t1 = text(t1_value);
    			attr_dev(span, "class", "uk-text-success");
    			attr_dev(span, "uk-icon", "icon: check");
    			add_location(span, file$2, 53, 36, 2271);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, span, anchor);
    			insert_dev(target, t0, anchor);
    			insert_dev(target, t1, anchor);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*audit_set*/ 2 && t1_value !== (t1_value = /*val*/ ctx[4].recurring_sum + "")) set_data_dev(t1, t1_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(span);
    			if (detaching) detach_dev(t0);
    			if (detaching) detach_dev(t1);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_3.name,
    		type: "if",
    		source: "(53:32) {#if val.has_autopay}",
    		ctx
    	});

    	return block;
    }

    // (62:32) {:else}
    function create_else_block_1(ctx) {
    	let span;

    	const block = {
    		c: function create() {
    			span = element("span");
    			attr_dev(span, "class", "uk-text-danger");
    			attr_dev(span, "uk-icon", "icon: close");
    			add_location(span, file$2, 62, 36, 2847);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, span, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(span);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block_1.name,
    		type: "else",
    		source: "(62:32) {:else}",
    		ctx
    	});

    	return block;
    }

    // (60:32) {#if val.has_op_account}
    function create_if_block_2(ctx) {
    	let span;

    	const block = {
    		c: function create() {
    			span = element("span");
    			attr_dev(span, "class", "uk-text-success");
    			attr_dev(span, "uk-icon", "icon: check");
    			add_location(span, file$2, 60, 36, 2707);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, span, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(span);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_2.name,
    		type: "if",
    		source: "(60:32) {#if val.has_op_account}",
    		ctx
    	});

    	return block;
    }

    // (69:32) {:else}
    function create_else_block(ctx) {
    	let span;

    	const block = {
    		c: function create() {
    			span = element("span");
    			attr_dev(span, "class", "uk-text-danger");
    			attr_dev(span, "uk-icon", "icon: close");
    			add_location(span, file$2, 69, 36, 3263);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, span, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(span);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block.name,
    		type: "else",
    		source: "(69:32) {:else}",
    		ctx
    	});

    	return block;
    }

    // (67:32) {#if val.has_op_balance}
    function create_if_block_1(ctx) {
    	let span;

    	const block = {
    		c: function create() {
    			span = element("span");
    			attr_dev(span, "class", "uk-text-success");
    			attr_dev(span, "uk-icon", "icon: check");
    			add_location(span, file$2, 67, 36, 3127);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, span, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(span);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_1.name,
    		type: "if",
    		source: "(67:32) {#if val.has_op_balance}",
    		ctx
    	});

    	return block;
    }

    // (48:20) {#each audit_set as val}
    function create_each_block(ctx) {
    	let tr;
    	let td0;
    	let t0_value = /*val*/ ctx[4].address + "";
    	let t0;
    	let t1;
    	let td1;
    	let t2_value = /*val*/ ctx[4].address + "";
    	let t2;
    	let t3;
    	let td2;
    	let t4;
    	let td3;
    	let t5;
    	let td4;
    	let t6;
    	let td5;
    	let span;
    	let t7;
    	let mounted;
    	let dispose;

    	function select_block_type_1(ctx, dirty) {
    		if (/*val*/ ctx[4].has_autopay) return create_if_block_3;
    		return create_else_block_2;
    	}

    	let current_block_type = select_block_type_1(ctx);
    	let if_block0 = current_block_type(ctx);

    	function select_block_type_2(ctx, dirty) {
    		if (/*val*/ ctx[4].has_op_account) return create_if_block_2;
    		return create_else_block_1;
    	}

    	let current_block_type_1 = select_block_type_2(ctx);
    	let if_block1 = current_block_type_1(ctx);

    	function select_block_type_3(ctx, dirty) {
    		if (/*val*/ ctx[4].has_op_balance) return create_if_block_1;
    		return create_else_block;
    	}

    	let current_block_type_2 = select_block_type_3(ctx);
    	let if_block2 = current_block_type_2(ctx);

    	function click_handler() {
    		return /*click_handler*/ ctx[3](/*val*/ ctx[4]);
    	}

    	const block = {
    		c: function create() {
    			tr = element("tr");
    			td0 = element("td");
    			t0 = text(t0_value);
    			t1 = space();
    			td1 = element("td");
    			t2 = text(t2_value);
    			t3 = space();
    			td2 = element("td");
    			if_block0.c();
    			t4 = space();
    			td3 = element("td");
    			if_block1.c();
    			t5 = space();
    			td4 = element("td");
    			if_block2.c();
    			t6 = space();
    			td5 = element("td");
    			span = element("span");
    			t7 = space();
    			attr_dev(td0, "class", "uk-visible@s uk-text-center");
    			add_location(td0, file$2, 49, 28, 1978);
    			attr_dev(td1, "class", "uk-hidden@s uk-text-truncate");
    			add_location(td1, file$2, 50, 28, 2065);
    			attr_dev(td2, "class", "uk-text-center");
    			add_location(td2, file$2, 51, 28, 2153);
    			attr_dev(td3, "class", "uk-text-center");
    			add_location(td3, file$2, 58, 28, 2586);
    			attr_dev(td4, "class", "uk-text-center");
    			add_location(td4, file$2, 65, 28, 3006);
    			attr_dev(span, "uk-icon", "icon: info");
    			attr_dev(span, "uk-toggle", "target: #" + modal_id);
    			add_location(span, file$2, 73, 32, 3482);
    			attr_dev(td5, "class", "uk-text-center");
    			add_location(td5, file$2, 72, 28, 3422);
    			add_location(tr, file$2, 48, 24, 1904);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, tr, anchor);
    			append_dev(tr, td0);
    			append_dev(td0, t0);
    			append_dev(tr, t1);
    			append_dev(tr, td1);
    			append_dev(td1, t2);
    			append_dev(tr, t3);
    			append_dev(tr, td2);
    			if_block0.m(td2, null);
    			append_dev(tr, t4);
    			append_dev(tr, td3);
    			if_block1.m(td3, null);
    			append_dev(tr, t5);
    			append_dev(tr, td4);
    			if_block2.m(td4, null);
    			append_dev(tr, t6);
    			append_dev(tr, td5);
    			append_dev(td5, span);
    			append_dev(tr, t7);

    			if (!mounted) {
    				dispose = listen_dev(tr, "click", click_handler, false, false, false);
    				mounted = true;
    			}
    		},
    		p: function update(new_ctx, dirty) {
    			ctx = new_ctx;
    			if (dirty & /*audit_set*/ 2 && t0_value !== (t0_value = /*val*/ ctx[4].address + "")) set_data_dev(t0, t0_value);
    			if (dirty & /*audit_set*/ 2 && t2_value !== (t2_value = /*val*/ ctx[4].address + "")) set_data_dev(t2, t2_value);

    			if (current_block_type === (current_block_type = select_block_type_1(ctx)) && if_block0) {
    				if_block0.p(ctx, dirty);
    			} else {
    				if_block0.d(1);
    				if_block0 = current_block_type(ctx);

    				if (if_block0) {
    					if_block0.c();
    					if_block0.m(td2, null);
    				}
    			}

    			if (current_block_type_1 !== (current_block_type_1 = select_block_type_2(ctx))) {
    				if_block1.d(1);
    				if_block1 = current_block_type_1(ctx);

    				if (if_block1) {
    					if_block1.c();
    					if_block1.m(td3, null);
    				}
    			}

    			if (current_block_type_2 !== (current_block_type_2 = select_block_type_3(ctx))) {
    				if_block2.d(1);
    				if_block2 = current_block_type_2(ctx);

    				if (if_block2) {
    					if_block2.c();
    					if_block2.m(td4, null);
    				}
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(tr);
    			if_block0.d();
    			if_block1.d();
    			if_block2.d();
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block.name,
    		type: "each",
    		source: "(48:20) {#each audit_set as val}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$2(ctx) {
    	let div;
    	let h2;
    	let t1;
    	let current_block_type_index;
    	let if_block;
    	let t2;
    	let validatormodal;
    	let current;
    	const if_block_creators = [create_if_block, create_else_block_3];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*data*/ ctx[0].chain_view) return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	validatormodal = new ValidatorModal({
    			props: {
    				validator: /*selected_val*/ ctx[2],
    				id: modal_id
    			},
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			div = element("div");
    			h2 = element("h2");
    			h2.textContent = "Audit Validators Configs";
    			t1 = space();
    			if_block.c();
    			t2 = space();
    			create_component(validatormodal.$$.fragment);
    			attr_dev(h2, "class", "uk-text-center uk-text-uppercase uk-text-muted uk-text-light uk-margin-medium-bottom");
    			add_location(h2, file$2, 30, 4, 1029);
    			add_location(div, file$2, 29, 0, 1019);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, h2);
    			append_dev(div, t1);
    			if_blocks[current_block_type_index].m(div, null);
    			append_dev(div, t2);
    			mount_component(validatormodal, div, null);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block = if_blocks[current_block_type_index];

    				if (!if_block) {
    					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block.c();
    				} else {
    					if_block.p(ctx, dirty);
    				}

    				transition_in(if_block, 1);
    				if_block.m(div, t2);
    			}

    			const validatormodal_changes = {};
    			if (dirty & /*selected_val*/ 4) validatormodal_changes.validator = /*selected_val*/ ctx[2];
    			validatormodal.$set(validatormodal_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(if_block);
    			transition_in(validatormodal.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(if_block);
    			transition_out(validatormodal.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			if_blocks[current_block_type_index].d();
    			destroy_component(validatormodal);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$2.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    const modal_id = "audit-tab-val-modal";

    function instance$2($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('AuditVals', slots, []);
    	let { data } = $$props;
    	let audit_set = [];
    	let selected_val = null;
    	const writable_props = ['data'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<AuditVals> was created with unknown prop '${key}'`);
    	});

    	const click_handler = val => $$invalidate(2, selected_val = val.view);

    	$$self.$$set = $$props => {
    		if ('data' in $$props) $$invalidate(0, data = $$props.data);
    	};

    	$$self.$capture_state = () => ({
    		ValidatorModal,
    		AuditSummary,
    		data,
    		modal_id,
    		audit_set,
    		selected_val
    	});

    	$$self.$inject_state = $$props => {
    		if ('data' in $$props) $$invalidate(0, data = $$props.data);
    		if ('audit_set' in $$props) $$invalidate(1, audit_set = $$props.audit_set);
    		if ('selected_val' in $$props) $$invalidate(2, selected_val = $$props.selected_val);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*data, selected_val, audit_set*/ 7) {
    			if (data.chain_view) {
    				$$invalidate(1, audit_set = data.chain_view.validator_view.map(each => {
    					let sum_formated = each.autopay && each.autopay.recurring_sum
    					? (each.autopay.recurring_sum / 100).toFixed(2) + "%"
    					: "";

    					return {
    						view: each,
    						address: each.account_address,
    						has_autopay: each.autopay && each.autopay.payments.length > 0,
    						has_op_account: each.validator_config.operator_account != null,
    						has_op_balance: each.validator_config.operator_has_balance,
    						recurring_sum: sum_formated
    					};
    				}));

    				if (selected_val == null) {
    					$$invalidate(2, selected_val = audit_set[0]);
    				}
    			}
    		}
    	};

    	return [data, audit_set, selected_val, click_handler];
    }

    class AuditVals extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, { data: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "AuditVals",
    			options,
    			id: create_fragment$2.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*data*/ ctx[0] === undefined && !('data' in props)) {
    			console.warn("<AuditVals> was created without expected prop 'data'");
    		}
    	}

    	get data() {
    		throw new Error("<AuditVals>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set data(value) {
    		throw new Error("<AuditVals>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/layout/Main.svelte generated by Svelte v3.44.2 */
    const file$1 = "src/components/layout/Main.svelte";

    function create_fragment$1(ctx) {
    	let main;
    	let nav;
    	let t0;
    	let div;
    	let ul;
    	let dash;
    	let t1;
    	let vals;
    	let t2;
    	let autopay;
    	let t3;
    	let watchlist;
    	let t4;
    	let auditvals;
    	let t5;
    	let upgrade;
    	let current;
    	nav = new Nav({ $$inline: true });

    	dash = new Dash({
    			props: { data: /*data*/ ctx[0] },
    			$$inline: true
    		});

    	vals = new Vals({
    			props: { data: /*data*/ ctx[0] },
    			$$inline: true
    		});

    	autopay = new AutoPay({
    			props: { account: /*data*/ ctx[0].account_view },
    			$$inline: true
    		});

    	watchlist = new WatchList({
    			props: { data: /*data*/ ctx[0] },
    			$$inline: true
    		});

    	auditvals = new AuditVals({
    			props: { data: /*data*/ ctx[0] },
    			$$inline: true
    		});

    	upgrade = new Upgrade({
    			props: { data: /*data*/ ctx[0] },
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			main = element("main");
    			create_component(nav.$$.fragment);
    			t0 = space();
    			div = element("div");
    			ul = element("ul");
    			create_component(dash.$$.fragment);
    			t1 = space();
    			create_component(vals.$$.fragment);
    			t2 = space();
    			create_component(autopay.$$.fragment);
    			t3 = space();
    			create_component(watchlist.$$.fragment);
    			t4 = space();
    			create_component(auditvals.$$.fragment);
    			t5 = space();
    			create_component(upgrade.$$.fragment);
    			attr_dev(ul, "class", "uk-switcher uk-margin switcher-container uk-height-large");
    			add_location(ul, file$1, 23, 4, 729);
    			attr_dev(div, "class", "uk-container uk-margin-top");
    			add_location(div, file$1, 22, 2, 684);
    			attr_dev(main, "uk-height-viewport", "expand: true");
    			attr_dev(main, "class", "uk-background-muted uk-overflow-auto");
    			add_location(main, file$1, 20, 0, 586);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			mount_component(nav, main, null);
    			append_dev(main, t0);
    			append_dev(main, div);
    			append_dev(div, ul);
    			mount_component(dash, ul, null);
    			append_dev(ul, t1);
    			mount_component(vals, ul, null);
    			append_dev(ul, t2);
    			mount_component(autopay, ul, null);
    			append_dev(ul, t3);
    			mount_component(watchlist, ul, null);
    			append_dev(ul, t4);
    			mount_component(auditvals, ul, null);
    			append_dev(ul, t5);
    			mount_component(upgrade, ul, null);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			const dash_changes = {};
    			if (dirty & /*data*/ 1) dash_changes.data = /*data*/ ctx[0];
    			dash.$set(dash_changes);
    			const vals_changes = {};
    			if (dirty & /*data*/ 1) vals_changes.data = /*data*/ ctx[0];
    			vals.$set(vals_changes);
    			const autopay_changes = {};
    			if (dirty & /*data*/ 1) autopay_changes.account = /*data*/ ctx[0].account_view;
    			autopay.$set(autopay_changes);
    			const watchlist_changes = {};
    			if (dirty & /*data*/ 1) watchlist_changes.data = /*data*/ ctx[0];
    			watchlist.$set(watchlist_changes);
    			const auditvals_changes = {};
    			if (dirty & /*data*/ 1) auditvals_changes.data = /*data*/ ctx[0];
    			auditvals.$set(auditvals_changes);
    			const upgrade_changes = {};
    			if (dirty & /*data*/ 1) upgrade_changes.data = /*data*/ ctx[0];
    			upgrade.$set(upgrade_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(nav.$$.fragment, local);
    			transition_in(dash.$$.fragment, local);
    			transition_in(vals.$$.fragment, local);
    			transition_in(autopay.$$.fragment, local);
    			transition_in(watchlist.$$.fragment, local);
    			transition_in(auditvals.$$.fragment, local);
    			transition_in(upgrade.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(nav.$$.fragment, local);
    			transition_out(dash.$$.fragment, local);
    			transition_out(vals.$$.fragment, local);
    			transition_out(autopay.$$.fragment, local);
    			transition_out(watchlist.$$.fragment, local);
    			transition_out(auditvals.$$.fragment, local);
    			transition_out(upgrade.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    			destroy_component(nav);
    			destroy_component(dash);
    			destroy_component(vals);
    			destroy_component(autopay);
    			destroy_component(watchlist);
    			destroy_component(auditvals);
    			destroy_component(upgrade);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$1.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Main', slots, []);
    	let data;

    	const unsubscribe = chainInfo.subscribe(info_str => {
    		$$invalidate(0, data = JSON.parse(info_str));
    	});

    	onDestroy(unsubscribe);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Main> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({
    		Nav,
    		Dash,
    		Vals,
    		Upgrade,
    		AutoPay,
    		WatchList,
    		AuditVals,
    		onDestroy,
    		chainInfo,
    		data,
    		unsubscribe
    	});

    	$$self.$inject_state = $$props => {
    		if ('data' in $$props) $$invalidate(0, data = $$props.data);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [data];
    }

    class Main extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Main",
    			options,
    			id: create_fragment$1.name
    		});
    	}
    }

    /* src/App.svelte generated by Svelte v3.44.2 */
    const file = "src/App.svelte";

    function create_fragment(ctx) {
    	let main1;
    	let main0;
    	let current;
    	main0 = new Main({ $$inline: true });

    	const block = {
    		c: function create() {
    			main1 = element("main");
    			create_component(main0.$$.fragment);
    			add_location(main1, file, 4, 0, 74);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main1, anchor);
    			mount_component(main0, main1, null);
    			current = true;
    		},
    		p: noop,
    		i: function intro(local) {
    			if (current) return;
    			transition_in(main0.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(main0.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main1);
    			destroy_component(main0);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('App', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ Main });
    	return [];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance, create_fragment, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment.name
    		});
    	}
    }

    const app = new App({
        target: document.body
    });

    return app;

})();
//# sourceMappingURL=bundle.js.map
