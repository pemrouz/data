# Reactive Data

### Simple Value

```
const data = $(10)
data.connect(input, 'value')
data[value] = 20
```

### Transforms

```
const todos = $([
    { task: 'foo', completed: true }
    { task: 'bar', completed: false }
    { task: 'boo', completed: false }
])

const todos.filter('completed', false)

render(document.body, body(
    li(remaining, ({ task }) => task)
))

// insert todo
todos.insert({ task: 'baz', completed: false })

// update existing todo
todos[2].completed = true

// delete todo
delete todos[1]
```
