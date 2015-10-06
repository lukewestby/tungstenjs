/**
 * Template constructor
 *
 * @author    Matt DeGennaro <mdegennaro@wayfair.com>
 */
'use strict';

var _ = require('underscore');
var templateToVdom = require('./template_to_vdom');
var ractiveTypes = require('./ractive_types');
var Context = require('./template_context');
var logger = require('./../utils/logger');

/**
 * Hash of registered partials
 * @type {Object}
 */
var registeredPartials = {};

var Template = function(templateObj, partials, view) {
  this.templateObj = templateObj;
  this.partials = partials;
  this.view = view;
};

Template.prototype.setPartials = function(partials) {
  this.partials = partials;
};

/**
 * Registers a template as a named partial
 * @param  {String} partialName Name to register the partial as
 */
Template.prototype.register = function(partialName) {
  registeredPartials[partialName] = this.templateObj;
};
/**
 * Outputs the template to a HTML string
 * @param  {Object} data Model to render the template with
 * @return {String}      HTML string of the rendered template
 */
Template.prototype.toString = function(data) {
  var templateToRender = this.templateObj;
  var tempView = this.view;
  if (this.view && !this.view.parentView) {
    templateToRender = templateToRender.f;
  }
  this.view = null;
  var output = templateToVdom.renderToString(templateToRender, data, this.partials || registeredPartials);
  this.view = tempView;
  return output;
};
/**
 * Outputs the template to a DocumentFragment
 * @param  {Object} data Model to render the template with
 * @return {Object}      DocumentFragment containing the template's DOM nodes
 */
Template.prototype.toDom = function(data) {
  var domFrag = templateToVdom.renderToDom(this.templateObj, data, this.partials || registeredPartials);
  // If we've attached a top level view, there will be a wrapper div that needs to be removed
  if (this.view && !this.view.parentView) {
    var viewWrapper = domFrag.childNodes[0];
    while (viewWrapper.childNodes.length) {
      domFrag.appendChild(viewWrapper.childNodes[0]);
    }
    domFrag.removeChild(viewWrapper);
  }
  return domFrag;
};
/**
 * Outputs the template to a VirtualTree
 * @param  {Object}  data        Model to render the template with
 * @param  {Boolean} firstRender Indicator that this is the first render
 * @return {Object}              VirtualTree representing the template
 */
Template.prototype.toVdom = function(data, firstRender) {
  return templateToVdom.renderToVdom(this.templateObj, data, this.partials || registeredPartials, this.view, firstRender);
};

/**
 * Iterate over the template to attach a view's childViews
 * @todo attach events?
 * @param  {Object}   view          View to attach
 * @param  {Object}   template      Template object to attach to
 * @param  {Function} widgetWrapper Constructor function to wrap childViews with
 * @param  {Object}   partials      Dictionary to lookup partials from
 * @param  {Object}   childClasses  Classes to look for for this View wrapper
 * @return {Object}                 Template object with attached view
 */
var attachViews = function(view, template, widgetWrapper, partials, childClasses) {
  var i, tmpl;

  // String is a dead-end
  if (typeof template === 'string') {
    return template;
  }

  // Arrays need iterating over
  if (Context.isArray(template)) {
    tmpl = new Array(template.length);
    for (i = 0; i < template.length; i++) {
      tmpl[i] = attachViews(view, template[i], widgetWrapper, partials, childClasses);
    }
    // short circuit
    return tmpl;
  }

  // If the view has childViews and this isn't the root, attempt to attach Widget
  if (!template.root && view.childViews) {
    // If cached version hasn't been passed down, parse childViews into an array of class names
    if (!childClasses) {
      childClasses = {};
      childClasses.flat = _.keys(view.childViews);
      childClasses.padded = _.map(childClasses.flat, function(key) {
        return ' ' + key + ' ';
      });
      childClasses.length = childClasses.flat.length;
    }
    // If this is an element with a class property, see if we should attach Widget
    if (template.a && template.a['class']) {
      var className = template.a['class'];
      // If className has dynamic values, filter them out to just the static ones
      if (typeof className !== 'string') {
        className = _.filter(className, function(obj) {
          return typeof obj === 'string';
        });
        className = className.join(' ');
      }
      // Pad with spaces for better hasClass-ing
      className = ' ' + className + ' ';
      for (i = childClasses.length; i--;) {
        if (className.indexOf(childClasses.padded[i]) > -1) {
          // If we match a childView class, replace the template with a Widget
          template = {
            type: 'Widget',
            constructor: widgetWrapper,
            childView: view.childViews[childClasses.flat[i]],
            template: new Template(template, partials)
          };
          break;
        }
      }
    }
  }

  // If this is a partial, lookup and recurse
  if (template.t === ractiveTypes.PARTIAL) {
    var partialName = Context.getInterpolatorKey(template);
    if (!partials[partialName]) {
      logger.warn('Warning: no partial registered with the name ' + partialName);
      return null;
    } else {
      var partialTemplate = partials[partialName];
      if (partialTemplate.templateObj) {
        partialTemplate = partialTemplate.templateObj;
      }
      return attachViews(view, partialTemplate, widgetWrapper, partials[partialName].partials || registeredPartials, childClasses);
    }
  }

  tmpl = _.clone(template);

  // Recurse on any child elements
  if (template.f) {
    tmpl.f = new Array(template.f.length);
    for (i = 0; i < tmpl.f.length; i++) {
      tmpl.f[i] = attachViews(view, template.f[i], widgetWrapper, partials, childClasses);
    }
    // in the event of a partial, we may get a nested array, this flattens it out
    tmpl.f = _.flatten(tmpl.f, true);
  }

  return tmpl;
};

/**
 * Wrap the template in a given tag, defaulting to <div>
 * @param  {String} tagName Tag name to wrap the template in
 * @return {Object}         Wrapped template
 */
Template.prototype.wrap = function(tagName) {
  return new Template({
    't': ractiveTypes.ELEMENT,
    'e': tagName || 'div',
    'f': this.templateObj
  }, this.partials);
};

/**
 * Exposed function to attachView
 * @param  {Object}   view          View to attach to
 * @param  {Function} widgetWrapper Constructor function for widget from adaptor
 * @return {Template}               New template with updated template object
 */
Template.prototype.attachView = function(view, widgetWrapper) {
  var templateObj = _.clone(this.templateObj);
  templateObj.root = true;
  // If this view is the top level wrapper, create a fake element to wrap it in
  if (!view.parentView) {
    // Create wrapper element based on view's element
    templateObj = {
      't': ractiveTypes.ELEMENT,
      'e': view.el.nodeName,
      'f': templateObj
    };
  }
  templateObj = attachViews(view, templateObj, widgetWrapper, this.partials || registeredPartials);
  return new Template(templateObj, this.partials, view);
};

module.exports = Template;
