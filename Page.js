import React, { Component } from 'react';
import classNames from 'classnames';
import Element from './Element';
import Draggable from 'react-draggable';

let throttled = false;

export default class Page extends Component {
  constructor(props) {
    super(props)
    this.state = {
      data: {},
      players: [],
      input: '',
      locks: {},
      positions: {},
    };
    this.components = {};
  }

  componentDidMount() {
    this.webSocket=new WebSocket('ws://' + document.location.host + '/sessions/' + this.props.session);

    this.webSocket.onopen = () => console.log('websocket client connected');
    this.webSocket.onclose = () => console.log('websocket client disconnected');
    this.webSocket.onmessage = e => {
      const res = JSON.parse(e.data);
      console.log("Received", res);
      switch(res.type) {
        case "update":
          this.setState({data: res.data});
          break;
        case "players":
          this.setState({players: res.players});
          break;
        case "updateLocks":
          this.setState({locks: res.data});
          break;
        case "updateElement":
          this.setState(state => Object.assign({}, state, {positions: Object.assign({}, state.positions, {[res.data.key]: {x: res.data.x, y: res.data.y}})}))
          break;
      };
    }

    setInterval(() => this.send('refresh'), 5000);
  }

  send(action, args) {
    this.webSocket.send(JSON.stringify(Object.assign({type: action}, args)));
  }

  gameAction() {
    this.send(
      'action', {
        payload: this.state.input.split(' ')
      }
    );
    this.setState({input: ''});
  }

  htmlToNode(html) {
    const fragment = document.createElement('template');
    fragment.innerHTML = html;
    return fragment.content.firstChild;
  }

  branch(node) {
    const branch = [];
    while (node.parentNode) {
      branch.unshift(Array.from(node.parentNode.childNodes).indexOf(node) + 1);
      node = node.parentNode;
    }
    return branch;
  }

  setPieceAt(key, attributes) {
    this.setState(state => {
      const html = this.htmlToNode(`<game>${this.state.data.board}</game>`);
      const el = html.querySelector(
        key.split('-').reduce((path, index) => `${path} > *:nth-child(${index})`, 'game')
      );
      for (const attr in attributes) {
        el.setAttribute(attr, attributes[attr]);
      }
      return Object.assign({}, state, {data: Object.assign({}, state.data, {board: html.innerHTML})})
    })
  }

  throttle(fn) {
    if (throttled) return;
    fn.call();
    setTimeout(() => throttled = false, 20);
    throttled = true;
  }

  startDrag(key) {
    this.send('requestLock', {payload: {key}});
    // set piece to uncontrolled
    this.setState(state => Object.assign({}, state, {positions: Object.assign({}, state.positions, {[key]: undefined})}))
  }

  dragging(key, x, y) {
    this.throttle(() => this.send('drag', {payload: {key, x, y}}));
  }

  stopDrag(key, x, y) {
    this.send('releaseLock', {payload: {key}});
    this.send('action', {payload: ['_moveElement', key, x, y]});
    // optimistically update the location to avoid flicker
    this.setPieceAt(key, {x, y})
  }

  renderGameElement(node) {
    const attributes = Array.from(node.attributes).
                             filter(attr => attr.name !== 'class' && attr.name !== 'id').
                             reduce((attrs, attr) => Object.assign(attrs, { [attr.name]: isNaN(attr.value) ? attr.value : +attr.value }), {});

    const type = node.nodeName.toLowerCase();
    const ElementClass = this.components[type] || "div";
    const key = this.branch(node).join('-')

    const element = (
      <div
        id={node.id}
        {...attributes}
        key={key}
        className={classNames(type, { mine: attributes.player === this.props.player })}
      >
      <ElementClass>
        {node.className === 'piece' ? node.id : Array.from(node.childNodes).map(child => this.renderGameElement(child))}
      </ElementClass>
      </div>
    );
    if (node.className === 'piece') {
      let position = this.state.positions[key];
      const x = attributes.x;
      const y = attributes.y;
      if (!position && !isNaN(x) && !isNaN(y) && !isNaN(parseFloat(x)) && !isNaN(parseFloat(y))) {
        position = {x, y};
      }
      return (
        <Draggable
        disabled={this.state.locks[key] && this.state.locks[key] !== this.props.player}
        onStart={() => this.startDrag(key)}
          onDrag={(e, data) => this.dragging(key, data.x, data.y)}
          onStop={(e, data) => this.stopDrag(key, data.x, data.y)}
          key={key}
          position={position}
        >
          {element}
        </Draggable>
      );
    }
    return element;
  }

  render() {
    return (
      <div>
        <div>
          Players:
          <ul>
            {this.state.players.map(player => (
              <li key={player.id}>{player.name} {player === this.state.players[this.state.data.currentPlayer] && '<--'}</li>
            ))}
          </ul>
        </div>
        <div>Game state: {JSON.stringify(this.state.data.variables)}</div>
      
        {this.state.data.phase === 'setup' && (
          <div>
            <button onClick={() => this.send('startGame')}>Start</button>
          </div>
        )}
        {this.state.data.phase === 'playing' && (
          <div>
            <div>
              {this.state.data.board && this.renderGameElement(this.htmlToNode(this.state.data.board))}
            </div>
            <div>
              <input value={this.state.input} onChange={e => this.setState({input: e.target.value})}/>
              <button onClick={() => this.gameAction()}>Send</button>
            </div>
          </div>
        )}
      </div>
    )
  }
}
