import React from 'react'
import ReactDOM from 'react-dom'

export { default as Page } from './Page'
export { default as Piece } from './Piece'

export const render = Component => ReactDOM.render(<Component />, document.getElementById('container'))
