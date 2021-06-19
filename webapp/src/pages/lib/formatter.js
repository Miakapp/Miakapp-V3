export const HTMLMinify = (value = '') => value
  .replace(/(((<script>)(.|\n)*?(<\/script>))|((<script>)(.|\n)*))|((<meta(.|\n)*?>)|(<script>(.|\n)*?(<\/script>)?))|( {2})/gi, '')
  .replace(/(\n)|(\r)|(\t)/gi, ' ');
export const formatVar = (v) => `${v}`.replace(/((\[\[)|(\]\]))|((\{\{)|(\}\}))/g, '');
export const crop = (val, len = 20) => (`${val}`.length <= len ? val : `${`${val}`.slice(0, len)}...`);
