import React, { Component } from 'react';
import classNames from 'classnames';
import Piece from './Piece';

export default class Page extends Component {
  constructor(props) {
    super(props)
    this.state = {
      data: {},
      players: [],
      input: ''
    }
    this.components = {};
  }

  componentDidMount() {
    const session = document.location.search.match(/[\?+]session=(\d+)/)[1]
    this.webSocket=new WebSocket('ws://' + document.location.host + '/sessions/' + session)

    this.webSocket.onopen = () => console.log('websocket client connected')
    this.webSocket.onclose = () => console.log('websocket client disconnected')
    this.webSocket.onmessage = e => {
      const res = JSON.parse(e.data)
      console.log("Received", res)
      if (res.type === 'update') {
        this.setState({data: res.data})
      }
      if (res.type === 'players') {
        this.setState({players: res.players})
      }
    }

    setInterval(() => this.send('refresh'), 5000)
  }

  send(action, args) {
    this.webSocket.send(JSON.stringify(Object.assign({type: action}, args)))
  }

  gameAction() {
    this.send(
      'action', {
        payload: this.state.input.split(' ')
      }
    )
    this.setState({input: ''})
  }

  htmlToNode(html) {
    const fragment = document.createElement('template')
    fragment.innerHTML = html
    return fragment.content.firstChild
  }

  renderGameElement(element) {
    //const Element = this.components[element.type] || Piece;

    const attributes = Array.from(element.attributes).
                             filter(attr => attr.name !== 'class' && attr.name !== 'id').
                             reduce((attrs, attr) => Object.assign(attrs, { [attr.name]: isNaN(attr.value) ? attr.value : +attr.value }), {});

    return (
      <Piece
      id={element.id}
      attributes={attributes}
        className={classNames(element.nodeName.toLowerCase(), { mine: attributes.player === this.props.player })}
      >
        {element.className === 'piece' ? element.id : Array.from(element.childNodes).map(node => this.renderGameElement(node))}
      </Piece>
    );
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
        
        <div>
          {this.state.data.board && this.renderGameElement(this.htmlToNode(this.state.data.board))}
        </div>
        <div>
          {this.state.data.pile && this.renderGameElement(this.htmlToNode(this.state.data.pile))}
        </div>

        {this.state.data.phase === 'setup' && (
          <div>
            <button onClick={() => this.send('startGame')}>Start</button>
          </div>
        )}
        {this.state.data.phase === 'playing' && (
          <div>
            <input value={this.state.input} onChange={e => this.setState({input: e.target.value})}/>
            <button onClick={() => this.gameAction()}>Send</button>
          </div>
        )}
      </div>
    )
  }
}
