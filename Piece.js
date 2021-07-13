import React from 'react';

export default props => {
  let { attributes, ...rest } = props;
  attributes = Object.keys(attributes).reduce((attrs, attr) => Object.assign(attrs, { [`data-${attr}`]: attributes[attr] }), {});
  return <div {...rest} {...attributes}>{props.children}</div>;
};
