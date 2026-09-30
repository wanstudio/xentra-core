# Owner Navigation Engine v1

## Locked navigation model

Owner Dashboard uses one centralized navigation controller for page navigation.

### Page navigation

- **Root destinations** replace the current app stack:
  - `overview`
  - `business`
  - `orders`
  - `finance/overview`
  - `more`
- **Child destinations** form an explicit route hierarchy.
- **Back** pops one managed page by traversing the corresponding History API entry.
- **Forward/browser Back** are synchronized through `history.state`.
- **Direct/deep links** are normalized into their deterministic parent chain.
- **Sibling destinations** replace the current page at the same hierarchy level instead of creating sibling-to-sibling Back loops.
- **Editor -> parent cancellation** is a pop operation, not a replace that leaves a duplicate parent history entry.
- **Editor -> resulting detail after save** may replace the editor at the same stack depth.

Canonical example:

```text
Bisnis
  -> Produk Master
      -> Tambah Produk

Back
  -> Produk Master
  -> Bisnis
```

Deep-link example:

```text
/dashboard#catalog/products/new

normalized stack:
[ business, catalog/products, catalog/products/new ]
```

## Separation of responsibilities

### Navigation engine

`apps/merchant-dashboard/assets/js/owner-navigation.js`

Owns:

- route stack state
- push / replace / pop semantics
- History API writes
- `popstate` synchronization
- direct hash synchronization
- deterministic route-chain reconstruction

### Dashboard router

`apps/merchant-dashboard/assets/js/dashboard.js`

Owns:

- route metadata
- route hierarchy configuration
- rendering the selected route
- compatibility adapter `navigateTo()`
- compatibility adapter `goBackFromChildPage()`

It does **not** mutate browser history directly.

### Presentation layer

`apps/merchant-shared/js/presentation-shells.js`

Modal, dialog, and bottom-sheet state remains separate from the page navigation stack.

Example:

```text
Page Stack
  Tambah Produk
       |
       +-- Presentation Stack
             Tambah Kelengkapan
```

Closing the presentation layer does not change the page stack.

## Browser history contract

The URL remains deep-linkable, but `history.state` contains the canonical application stack for each app entry:

```js
{
  __xentraNavigation: 1,
  route: 'catalog/products/new',
  stack: [
    'business',
    'catalog/products',
    'catalog/products/new'
  ]
}
```

This makes browser traversal and in-app Back use the same navigation model rather than independent page-specific logic.

## Testing contract

Navigation tests must cover at minimum:

1. Business -> Product Master -> Add Product -> Back -> Product Master -> Back -> Business.
2. Product Master -> Product Detail -> Back -> Product Master.
3. Orders -> Order Detail -> Back -> Orders.
4. Direct Add Product deep link reconstructs its parent chain.
5. Sibling navigation does not create sibling-to-sibling Back loops.
6. Browser Back and app Back render the same route state.
7. Modal/bottom-sheet close does not mutate the page stack.
