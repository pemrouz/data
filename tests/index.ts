
// @ts-nocheck
import { $, render, HTML } from '/index.js'
const { body, div, li, custom_element } = HTML
const o = {
    A: { name: 'foo' },
    B: { name: 'bar' },
}
const data = window.data = $(o)

render(document.body, body(
    div.tests(
        // static
        div.test_string('string'),
        div.test_number(10),
        div.test_none(),
        div.test_undefined(undefined),
        div.test_object({ foo: 1, bar: 2 }),
        div.test_array([1, 2]),
        div.test_true(true),
        div.test_false(false),

        // fn input  
        div.test_string_fn_string('a', (_, d) => d + 'string'),
        div.test_number_fn_string(10, (_, d) => d + 'number'),
        div.test_none_fn_string(node => node.text('none')),
        div.test_undefined_fn_string(undefined, (_, d) => d + 'undefined'),
        div.test_array_fn_string([1, 2], (_, d) => d + 'array'),
        div.test_true_fn_string(true, (_, d) => d + 'true'),
        div.test_false_fn_string(false, (_, d) => d + 'false'),
        div.test_multiple_fn
            (node => node.text('a'))
            (node => node.text('b'))
            (node => node.text('c')),

        // fn return 
        div.test_static_fn_string(o, () => 'string'),
        div.test_static_fn_number(o, () => 10),
        div.test_static_fn_undefined(o, () => { }),
        div.test_static_fn_object(o, () => ({ foo: 3, bar: 4 })),
        div.test_static_fn_array(o, () => [3, 4]),
        div.test_static_fn_true(o, () => true),
        div.test_static_fn_false(o, () => false),

        // data
        div.test_data_string($('string')),
        div.test_data_number($(10)),
        div.test_data_undefined($()),
        div.test_data_object($({ foo: 1, bar: 2 })),
        div.test_data_array($([1, 2])),
        div.test_data_true($(true)),
        div.test_data_false($(false)),

        // data + fn 
        div.test_data_fn_string(data, () => 'string'),
        div.test_data_fn_number(data, () => 10),
        div.test_data_fn_undefined(data, () => undefined),
        div.test_data_fn_object(data, () => ({ foo: 1 })),
        div.test_data_fn_array(data, () => [2]),
        div.test_data_fn_true(data, () => true),
        div.test_data_fn_false(data, () => false),

        // static + fn + node
        div.test_static_fn_node(o, (node, { name }, key) => node(
            div.key(key),
            div.val(name),
        )),

        // static nested         
        div.test_static_nested(
            li(o, (node, row, key) => node(
                div.key(key),
                div(row, (node, name) => node.inner.text(name))
            ))
        ),

        div.dynamic(
            div(
                // data + fn + node
                div.test_data_fn_node(
                    li(data, (node, { name }, key) => node(
                        div.key(key),
                        div.val(name),
                    ))
                ),

                // data (arr) + fn + node
                div.test_data_arr_fn_node(
                    li(data.to(Object.values), (node, { name }, key) => node(
                        div.key(key),
                        div.val(name),
                    ))
                ),

                // nested
                div.test_nested(
                    li(data, (node, row, key) => node(
                        div.key(key),
                        div(row, (node, name) => node.inner.text(name))
                    ))
                ),
            )
        ),

        // random tag
        custom_element.foo(1),

        // shorthand
        div['test_sh_attr=foo'],
        div['#test_sh_id'],
        div.test_sh_class,

        // attr
        div.test_attr_string.attr('attr', 'string'),
        div.test_attr_number.attr('attr', 10),
        div.test_attr_none.attr('attr'),
        div.test_attr_undefined.attr('attr', undefined),
        div.test_attr_true.attr('attr', true),
        div.test_attr_false.attr('attr', false),
        div.test_attr_object.attr('attr', { foo: 1, bar: 2 }),
        div.test_attr_array.attr('attr', [1, 2]),
        div.test_attr_multiple.attr({
            attr_string: 'foo',
            attr_number: 10,
            attr_undefined: undefined,
            attr_true: true,
            attr_false: false,
            attr_object: { foo: 1, bar: 2 },
            attr_array: [1, 2],
        }),

        // attr + data
        div.test_attr_data_string.attr('attr', $('string')),
        div.test_attr_data_number.attr('attr', $(10)),
        div.test_attr_data_undefined.attr('attr', $()),
        div.test_attr_data_true.attr('attr', $(true)),
        div.test_attr_data_false.attr('attr', $(false)),
        div.test_attr_data_object.attr('attr', $({ foo: 1, bar: 2 })),
        div.test_attr_data_array.attr('attr', $([1, 2])),

        // class
        div.test_class_string.class('class', 'string'),
        div.test_class_number.class('class', 10),
        div.test_class_none.class('class'),
        div.test_class_undefined.class('class', undefined),
        div.test_class_true.class('class', true),
        div.test_class_false.class('class', false),
        div.test_class_object.class('class', { foo: 1, bar: 2 }),
        div.test_class_array.class('class', [1, 2]),
        div.test_class_multiple.class({
            class_string: 'foo',
            class_number: 10,
            class_undefined: undefined,
            class_true: true,
            class_false: false,
            class_object: { foo: 1, bar: 2 },
            class_array: [1, 2],
        }),

        // class + data
        div.test_class_data_string.class('class', $('string')),
        div.test_class_data_number.class('class', $(10)),
        div.test_class_data_undefined.class('class', $()),
        div.test_class_data_true.class('class', $(true)),
        div.test_class_data_false.class('class', $(false)),
        div.test_class_data_object.class('class', $({ foo: 1, bar: 2 })),
        div.test_class_data_array.class('class', $([1, 2])),

        // style
        div.test_style_string.style('color', 'red'),
        div.test_style_number.style('width', 10),
        div.test_style_none.style('color'),
        div.test_style_undefined.style('color', undefined),
        div.test_style_true.style('color', true),
        div.test_style_false.style('color', false),
        div.test_style_object.style('color', { foo: 1, bar: 2 }),
        div.test_style_array.style('color', [1, 2]),
        div.test_style_multiple.style({
            color: 'red',
            width: 10,
        }),

        // style + data
        div.test_style_data_string.style('color', $('red')),
        div.test_style_data_number.style('width', $(10)),
        div.test_style_data_undefined.style('color', $()),
        div.test_style_data_true.style('color', $(true)),
        div.test_style_data_false.style('color', $(false)),
        div.test_style_data_object.style('color', $({ foo: 1, bar: 2 })),
        div.test_style_data_array.style('color', $([1, 2])),

        // id
        div.test_id_string.id('my-id', 'red'),
        div.test_id_number.id('my-id', 10),
        div.test_id_none.id('my-id'),
        div.test_id_undefined.id('my-id', undefined),
        div.test_id_true.id('my-id', true),
        div.test_id_false.id('my-id', false),
        div.test_id_object.id('my-id', { foo: 1, bar: 2 }),
        div.test_id_array.id('my-id', [1, 2]),
        div.test_id_multiple.id({
            my_id: true,
        }),

        // id + data
        div.test_id_data_string.id('my-id', $('red')),
        div.test_id_data_number.id('my-id', $(10)),
        div.test_id_data_undefined.id('my-id', $()),
        div.test_id_data_true.id('my-id', $(true)),
        div.test_id_data_false.id('my-id', $(false)),
        div.test_id_data_object.id('my-id', $({ foo: 1, bar: 2 })),
        div.test_id_data_array.id('my-id', $([1, 2])),

        // text
        div.test_text_string.text('text', 'red'),
        div.test_text_number.text('text', 10),
        div.test_text_none.text('text'),
        div.test_text_undefined.text('text', undefined),
        div.test_text_true.text('text', true),
        div.test_text_false.text('text', false),
        div.test_text_object.text('text', { foo: 1, bar: 2 }),
        div.test_text_array.text('text', [1, 2]),
        div.test_text_multiple.text({
            text_string: 'foo',
            text_number: 10,
            text_undefined: undefined,
            text_true: true,
            text_false: false,
            text_object: { foo: 1, bar: 2 },
            text_array: [1, 2],
        }),

        // text + data
        div.test_text_data_string.text('text', $('red')),
        div.test_text_data_number.text('text', $(10)),
        div.test_text_data_undefined.text('text', $()),
        div.test_text_data_true.text('text', $(true)),
        div.test_text_data_false.text('text', $(false)),
        div.test_text_data_object.text('text', $({ foo: 1, bar: 2 })),
        div.test_text_data_array.text('text', $([1, 2])),

        // event 
        div.test_event
            .on('click', ev => { ev.target.innerHTML = 'clicked' })
            .text('click')
    )
))