import React, { Component } from 'react';
import classNames from 'classnames';
import Draggable from 'react-draggable';
import ReconnectingWebSocket from 'reconnecting-websocket';
let throttled = false;
import style from './style.scss';

const DRAG_TOLERANCE = 2

export default class Page extends Component {
  constructor(props) {
    super(props)
    this.state = {
      action: null, // currently selected action
      args: [], // current action args
      prompt: null, // current prompt
      choices: null, // current choices (array, "text" or {min, max})
      data: {}, // complete server state
      input: '',
      locks: {}, // locks from server
      positions: {}, // xy positions from server
      actions: null, // currently possible actions in menu
      ctxpos: null, // position of ctx menu
      dragging: null, // data on the current drag {key, x/y start point, zone starting zone}
    };
    this.components = {};
  }

  componentDidMount() {
    this.webSocket=new ReconnectingWebSocket('ws://' + document.location.host + '/sessions/' + this.props.session);

    this.webSocket.onopen = () => {
      this.refreshInterval = setInterval(() => {
        this.send('refresh');
      }, 3000);
    };
    this.webSocket.onclose = () => {
      clearInterval(this.refreshInterval);
    }
    this.webSocket.onmessage = e => {
      const res = JSON.parse(e.data);
      console.log("Received", res);
      switch(res.type) {
        case "state":
          if (res.payload) {
            this.setState({data: res.payload});
            if (Object.entries(res.payload.allowedActions).length == 1) {
              const [action, details] = Object.entries(res.payload.allowedActions)[0];
              this.setState({action, args: details.args, prompt: details.prompt, choices: details.choices});
            } else {
              this.setState({action: null, args: [], prompt: null, choices: null});
            }
          }
          break;
        case "updateLocks":
          this.setState({locks: res.payload});
          break;
        case "updateElement":
          if (res.payload) {
            let {key, x, y, start, end, endFlip} = res.payload;
            if (start) {
              const startZone = this.elementByKey(start);
              const endZone = this.elementByKey(end);
              const startRect = startZone.getBoundingClientRect();
              const endRect = endZone.getBoundingClientRect();
              const parentRect = this.elementByKey(this.parentKey(key)).getBoundingClientRect();
              const keyRect = this.elementByKey(key).getBoundingClientRect();
              const startFlip = this.isFlipped(startZone);
              if (startFlip) {
                x -= endRect.right - startRect.right;
                y -= endRect.bottom - startRect.bottom;
              } else {
                x += endRect.left - startRect.left;
                y += endRect.top - startRect.top;
              }

              if (endFlip ^ (startFlip ^ this.isFlipped(endZone))) { // endzones were flipped respective to each other
                if (startFlip) {
                  x = parentRect.right * 2 - keyRect.width - endRect.right - x - endRect.left;
                  y = parentRect.bottom * 2 - keyRect.height - endRect.bottom - y - endRect.top;
                } else {
                  x = - parentRect.left * 2 - keyRect.width + endRect.right - x + endRect.left;
                  y = - parentRect.top * 2 - keyRect.height + endRect.bottom - y + endRect.top;
                }
              }
            }
            this.updatePosition(key, x, y);
          }
          break;
      }
    }
    document.addEventListener('touchmove', e => {
      const el = document.elementFromPoint(e.touches[0].pageX, e.touches[0].pageY);
      if (el) {
        this.setState({dragOver: el.getAttribute('data-key')})
      }
    });
    this.send('refresh');
  }

  send(action, payload) {
    payload = payload || {}
    this.webSocket.send(JSON.stringify({type: action, payload}));
  }

  gameAction(action, ...args) {
    console.log('gameAction', action, ...args);
    this.send(
      'action', {
        sequence: this.state.data.sequence,
        action: [action, ...args]
      },
    );
    this.setState({actions: null, action: null, args: [], prompt: null, choices: null});
  }

  player() {
    return this.state.data.players && this.state.data.players.indexOf(this.props.userId) + 1;
  }

  xmlToNode(xml) {
    // TODO memoize
    return new DOMParser().parseFromString(xml, 'text/xml').firstChild;
  }

  branch(node) {
    const branch = [];
    while (node.parentNode) {
      branch.unshift(Array.from(node.parentNode.childNodes).indexOf(node) + 1);
      node = node.parentNode;
    }
    return branch;
  }

  keyFromEl(el) {
    return el.getAttribute('data-key');
  }

  setPieceAt(key, attributes) {
    const xml = this.xmlToNode(this.state.data.doc);
    const el = xml.querySelector(
      key.slice(2).split('-').reduce((path, index) => `${path} > *:nth-child(${index})`, 'game')
    );
    this.setState(state => {
      for (const attr in attributes) {
        el.setAttribute(attr, attributes[attr]);
      }
      return Object.assign({}, state, {data: Object.assign({}, state.data, {doc: xml.outerHTML})});
    })
  }

  updatePosition(key, x, y) {
    this.setState(state => Object.assign({}, state, {positions: Object.assign({}, state.positions, {[key]: x !== undefined ? {x, y} : undefined })}));
  }


  elementByKey(key) {
    return document.querySelector(`#game *[data-key="${key}"]`);
  }

  throttle(fn) {
    if (throttled) return;
    fn.call();
    setTimeout(() => throttled = false, 20);
    throttled = true;
  }

  parentKey(key) {
    return key.slice(0,-2);
  }

  zoneForEl(el) {
    while(el.parentNode && el.parentNode.id != "game") el = el.parentNode;
    return el.parentNode ? el : null;
  }

  zoneForKey(key) {
    return key.split('-').slice(0,2).join('-');
  }

  zoneForPoint(x, y) {
    let el = this.zoneForEl(document.elementFromPoint(x, y));
    if (el) return {el, x: x - el.getBoundingClientRect().x, y: y - el.getBoundingClientRect().y};
  }

  startDrag(key, x, y) {
    this.send('requestLock', {key});
    this.setState({dragging: {key, x, y, zone: this.zoneForKey(key)}})
    // set piece to uncontrolled
    this.updatePosition(key)
  }

  isFlipped(el) {
    // supports zone flipping by 180
    return el.matches('.flipped, .flipped *')
  }

  dragging(key, x, y, event) {
    const absX = event.clientX;
    const absY = event.clientY;
    const zone = this.zoneForPoint(absX, absY);
    const dragData = {key, x, y};
    // crossing zones so add the zone translation
    if (zone && zone.el.getAttribute('data-key') != this.state.dragging.zone) {
      const startZone = this.elementByKey(this.state.dragging.zone)
      const endZone = zone.el
      dragData.start = this.keyFromEl(startZone);
      dragData.end = this.keyFromEl(endZone);
      dragData.endFlip = this.isFlipped(startZone) ^ this.isFlipped(endZone);
      if (this.isFlipped(startZone)) {
        dragData.x -= startZone.getBoundingClientRect().right - endZone.getBoundingClientRect().right;
        dragData.y -= startZone.getBoundingClientRect().bottom - endZone.getBoundingClientRect().bottom;
      } else {
        dragData.x += startZone.getBoundingClientRect().x - endZone.getBoundingClientRect().x;
        dragData.y += startZone.getBoundingClientRect().y - endZone.getBoundingClientRect().y;
      }
    }
    this.setState({dragMove: true});
    this.throttle(() => this.send('drag', dragData));
  }

  stopDrag(key, x, y, event) {
    this.send('releaseLock', {key});
    const {dragging, dragOver} = this.state;
    this.setState({dragging: null, dragMove: false});
    if (dragging && dragging.key === key && Math.abs(dragging.x - x) + Math.abs(dragging.y - y) > DRAG_TOLERANCE) {
      const dragAction = this.allowedDragSpaces(key)[dragOver];
      if (dragAction) {
        const ontoXY = this.elementByKey(dragOver).getBoundingClientRect();
        const elXY = this.elementByKey(key).getBoundingClientRect();
        this.gameAction(dragAction, `$el(${key})`, `$el(${dragOver})`, elXY.x - ontoXY.x, elXY.y - ontoXY.y);
        // optimistically update the location to avoid flicker
        this.setPieceAt(key, {x, y});
      } else if (!dragOver || dragOver === this.parentKey(key)) {
        this.gameAction('moveElement', `$el(${key})`, x, y);
        // optimistically update the location to avoid flicker
        this.setPieceAt(key, {x, y});
      } else {
        // invalid drag - put it back
        this.setPieceAt(key, {x: dragging.x, y: dragging.y});
      }
    } else {
      const pos = event.changedTouches && event.changedTouches[0] || event // handle mouse touch coords
      this.handleClick(`$el(${key})`, {x:pos.pageX, y:pos.pageY})
    }
  }

  handleClick(choice, {x, y}) {
    const actions = this.actionsFor(choice);
    const args = this.state.args.concat(choice)
    console.log('actions', actions, args, {x,y})
    if (Object.keys(actions).length == 1) {
      this.gameAction(Object.keys(actions)[0], ...args)
    } else if (Object.keys(actions).length > 1) {
      this.setState({args, actions, ctxpos: {x, y}})
    }
  }

  // return available actions association to this element (TODO does this need to go up through parent chain?)
  actionsFor(choice) {
    if (!this.state.data.allowedActions) return []
    return Object.entries(this.state.data.allowedActions).reduce((actions, [action, result]) => {
      if (result.choices.includes(choice)) {
        actions[action] = result.prompt
      }
      return actions;
    }, [])
  }

  isAllowedMove(node) {
    return this.state.data.allowedMove && node.matches(this.state.data.allowedMove);
  }

  allowedDragSpaces(key) {
    return Object.entries(this.state.data.allowedDrags).reduce((dragSpaces, [action, {pieces, spaces}]) => {
      if (pieces.includes(`$el(${key})`)) {
        spaces.forEach(space => dragSpaces[space.slice(4, -1)] = action)
      }
      return dragSpaces;
    }, {});
  }

  renderBoard(board) {
    return <div id="game">
      {this.renderGameElement(board.querySelector(`#player-mat:not([player="${this.player()}"])`), true)} {/* TODO assumed 2 player */}
      {this.renderGameElement(board.querySelector('#board'))}
      {this.renderGameElement(board.querySelector(`#player-mat[player="${this.player()}"]`))}
    </div>
  }

  renderGameElement(node, flipped, parentFlipped) {
    const attributes = Array.from(node.attributes).
                             filter(attr => attr.name !== 'class' && attr.name !== 'id').
                             reduce((attrs, attr) => Object.assign(attrs, { [attr.name]: isNaN(attr.value) ? attr.value : +attr.value }), {});

    const type = node.nodeName.toLowerCase();
    const ElementClass = this.components[type] || 'div';
    const key = this.branch(node).join('-')

    const props = {
      key,
      "data-key": key,
      ...attributes,
      onContextMenu: e => {
        e.preventDefault();
        this.handleClick(`$el(${key})`, {x: e.pageX, y: e.pageY})
      },
      className: classNames(type, node.className, {
        mine: attributes.player === this.player(),
        flipped,
        "hilited": (
          (this.state.dragMove && key==this.state.dragOver && this.allowedDragSpaces(this.state.dragging.key)[key]) ||
          (this.state.choices instanceof Array && this.state.choices.includes(`$el(${key})`))
        )
      }),
    };
    if (node.id) props.id = node.id

    if (node.className == 'space') {
      props.onMouseEnter=() => this.setState({dragOver: key})
      props.onMouseLeave=() => this.setState({dragOver: this.parentKey(key)})
    }

    const contents = node.className === 'piece' ? node.id : Array.from(node.childNodes).map(child => this.renderGameElement(child, false, flipped || parentFlipped));

    if (this.isAllowedMove(node)) {
      let position = this.state.positions[key];
      const x = attributes.x;
      const y = attributes.y;
      if (!position && !isNaN(x) && !isNaN(y) && !isNaN(parseFloat(x)) && !isNaN(parseFloat(y))) {
        position = {x, y};
      }
      return (
        <Draggable
          disabled={this.state.locks[key] && this.state.locks[key] !== this.props.userId}
          onStart={(e, data) => this.startDrag(key, data.x, data.y)}
          onDrag={(e, data) => this.dragging(key, data.x, data.y, e)}
          onStop={(e, data) => this.stopDrag(key, data.x, data.y, e)}
          key={key}
          position={position || {x:0, y:0}}
          scale={parentFlipped ? -1 : 1}
        >
          <div
            className={classNames({"external-dragging": !!this.state.positions[key]})}
            style={this.state.dragging ? {pointerEvents: "none"} : ""}
          > {/* wrapper for draggable */}
            <ElementClass {...props}>{contents}</ElementClass>
          </div>
        </Draggable>
      );
    } else {
      return <ElementClass {...props} onClick={e => {this.handleClick(`$el(${key})`, {x:e.pageX, y:e.pageY}); return e.stopPropagation()}}>{contents}</ElementClass>
    }
  }

  render() {
    const choice = this.state.args.slice(-1)
    return (
      <div>
        {this.state.prompt && <div id="messages">
          <div id="inner">
            <div id="prompt">{this.state.prompt}</div>
            <button onClick={() => this.send('update')}>Cancel</button>
          </div>
        </div>}
        {/* <div>{this.state.dragOver}</div> */}
        {this.state.data.phase === 'playing' && this.state.data.doc && this.renderBoard(this.xmlToNode(this.state.data.doc))}

        {this.state.actions && this.state.ctxpos &&
         <ul
           id="context-menu"
           style={{top: this.state.ctxpos.y, left: this.state.ctxpos.x}}
           onMouseEnter={() => choice.slice(0,4) == '$el(' && this.setPieceAt(choice.slice(4,-1), {'data-ctx-hover': true})}
           onMouseLeave={() => {this.setState({actions: null, args:[]}); choice.slice(0,4) == '$el(' && this.setPieceAt(choice.slice(4,-1), {'data-ctx-hover': false})}}
         >
           {Object.entries(this.state.actions).map(([a, prompt]) => (
             <li key={a} onClick={e => {this.gameAction(a, ...this.state.args); e.stopPropagation()}}>{prompt}</li>
           ))}
         </ul>
        }
      </div>
    )
  }
}
