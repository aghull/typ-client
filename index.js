import React from 'react'
import ReactDOM from 'react-dom'

export { default as Page } from './Page'
export { default as Element } from './Element'

export const render = Component => ReactDOM.render(<Component />, document.getElementById('container'))
