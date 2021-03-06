/**
 * shows the buttons to export a table
 */
cdb.admin.ExportTableOptions = cdb.core.View.extend({

  className: "download_buttons",

  _CSV_FILTER: "SELECT * FROM (%%sql%%) as subq ",
  _MAX_SQL_GET_LENGTH: 1000,
  events: cdb.core.View.extendEvents({
    'click .export:not(.disabled)': '_export'
  }),

  /**
   * Allowed formats on the exporter
   * @type {Array}
   */
  formats: [
    {format: 'csv', fetcher: 'fetchCSV', geomRequired: false},
    {format: 'shp', fetcher: 'fetch', geomRequired: true},
    {format: 'kml', fetcher: 'fetch', geomRequired: true},
    {format: 'svg', fetcher: 'fetchSVG', geomRequired: true},
    {format: 'geojson', fetcher: 'fetch', geomRequired: true},
    {format: 'api call', fetcher: 'showAPIDialog' }
  ],

  initialize: function() {
    _.extend(this.options, {
      title: "Select your file type",
      description: '',
      template_name: 'old_common/views/dialog_base',
      clean_on_hide: true,
      ok_button_classes: "button grey",
      ok_title: "",
      modal_type: "",
      width: 510,
      modal_class: 'export_table_dialog',
      include_footer: false,
      table_id: this.model.id
    });

    _.bindAll(this, '_export');
    this.baseUrl = cdb.config.getSqlApiUrl();
    this.model.bind('change:geometry_types', function() {
      this.refresh();
    }, this)
  },

  /**
   * search a format based on its name in the format array
   * @param  {string} format Format name
   * @return {Object}
   */
  getFormat: function(format) {
    for(var n in this.formats) {
      if(this.formats[n].format === format) {
        return this.formats[n]
      }
    }
  },

  /**
   * Answer to button event and lauchn the export method associated to that format
   * @param  {Event} ev
   */
  _export: function(ev) {
    this.killEvent(ev);
    var $button = $(ev.currentTarget);
    var formatName = $button.data('format');
    var format = this.getFormat(formatName);
    this[format.fetcher](formatName);
  },


  /**
   * Create a dictionary with the options shared between all the methods
   * @return {Object}
   */
  getBaseOptions: function() {
    var options = {};

    // If table name is qualified, get last part 
    var filename = this.model.get('name');
    if (this.model.get('name').search('.') !== -1) {
      options.filename = this.model.getUnqualifiedName();
    }

    if (this.options.user_data) {
      options.api_key = this.options.user_data.api_key;
    }

    return options;
  },

  /**
   * Returns the base sql to retrieve the data
   * @return {string}
   */
  getPlainSql: function() {
    if(this.options.sql) {
      sql = this.options.sql;
    } else {
      if(this.model.sqlView) {
        sql = this.model.sqlView.getSQL();
      } else {
        sql = "select * from " + this.model.get('name')
      }
    }
    return sql;
  },

  /**
   * Returns a specific sql filtered by the_geom, used on CSV exports
   * @return {string}
   */
  getGeomFilteredSql: function() {
    var sql = this.getPlainSql();
    // if we have "the_geom" in our current schema, we apply a custom sql
    if(this.model.isGeoreferenced()) {
      return this._CSV_FILTER.replace(/%%sql%%/g, sql);
    }
    // if not, we apply regular sql
    return sql;

  },

  /**
   * Populates the hidden form with the format related values and submit them to get the file
   * @param  {Object} options Base options
   * @param  {String} sql Sql of the document to be retrieved
   */
  _fetch: function(options, sql) {
    var self = this;
    this.$('.error').html('').hide();
    this.$('.format').val(options.format);
    this.$('.q').val(sql);
    this.$('.filename').val(options.filename);
    this.$('.api_key').val(options.api_key);
    this.$('.generating').fadeIn();
    this.$('.geospatial').fadeOut();

    if (options.format === 'csv') {
      this.$('.skipfields').val("the_geom_webmercator");
    } else {
      this.$('.skipfields').val("the_geom,the_geom_webmercator");
    }

    // Stats purposes
    cdb.god.trigger('mixpanel', "Exported table data", {
      filename: this.$('form input[name="filename"]').val(),
      type:     this.$('form input[name="format"]').val()
    });

    // check if the sql is big or not, and send the request as a verb or other. This is a HACK.
    if (sql.length < this._MAX_SQL_GET_LENGTH) {
      var location = this.$('form').attr('action') + '?' + this.$('form').serialize()
      this._fetchGET(location);
    } else {
      // I can't find a way of making the iframe trigger load event when its get a form posted,
      // so we need to leave like it was until
      this.submit();
    }

    this.$('.db').attr('disabled', 'disabled');
    this.$('.skipfields').attr('disabled', 'disabled');

    if (this.options.autoClose) {
      //this.hide();
      this.trigger('generating', this.$('.generating').html());
    }

  },

  showError: function(error) {
    this.$('.generating').hide()
    this.$('.error').html("<p>" + error + "</p>").fadeIn();
  },

  _fetchGET: function(url) {
      
      function getError(content) {
        // sql api returns a json when it fails
        // but if the browser is running some plugin that
        // formats it, the window content is the html
        // so search for the word "error"
        var error = null;
        try {
          var json = JSON.parse(content);
          error = json.error[0];
        } catch(e) {
          if (content && content.indexOf('error') !== -1) {
            error = "an error occurred";
          }
        }
        return error;
      }

      var self = this;
      var checkInterval;

      var w = window.open(url);
      w.onload = function() {
        clearInterval(checkInterval);
        var error = getError(w.document.body.textContent);
        if(error) {
          self.showError(error); 
        } else {
          self.hide();
        }
        w.close();
      };

      window.focus();

      checkInterval = setInterval(function check() {
        // safari needs to check the body because it never
        // calls onload
        if (w.closed || (w.document && w.document.body.textContent.length === 0)) {
          //self.hide();
          clearInterval(checkInterval);
        }
      }, 100)
  },

  /**
   * Submits the form. This method is separated to ease the testing
   */
  submit: function() {
    this.$('form').submit();
  },

  /**
   * Base fetch, for the formats that don't require special threatment
   * @param  {String} formatName
   */
  fetch: function(formatName) {
    var options = this.getBaseOptions();
    options.format = formatName;
    var sql = this.getPlainSql();
    this._fetch(options, sql);
  },

  /**
   * Gets the options needed for csv format and fetch the document
   * @param  {String} formatName
   */
  fetchCSV: function() {
    var options = this.getBaseOptions();
    options.format = 'csv';
    var sql = this.getGeomFilteredSql();
    this.$('.skipfields').removeAttr('disabled');
    this._fetch(options, sql);
  },
  /**
   * Gets the options needed for svg format and fetch the document
   * @param  {String} formatName
   */
  fetchSVG: function(){
    this.$('.db').removeAttr('disabled');
    this.fetch('svg');
  },

  /**
   * Gets the options needed for svg format and fetch the document
   * @param  {String} formatName
   */
  showAPIDialog: function() {

    var dlg = new cdb.admin.BaseDialog({
      title: "Query this table",
      table: this.model.attributes,
      schema: this.model.attributes.original_schema.slice(0, 5),
      url: window.location.host,
      original_schema: this.model.attributes.original_schema,
      template_name: 'old_common/views/api_dialog',
      clean_on_hide: true,
      enter_to_confirm: true,
      ok_button_classes: "right button grey",
      ok_title: "Ok, close",
      cancel_button_classes: "underline margin15",
      modal_type: "api",
      width: 592
    });

    dlg.ok = function() { };

    $("body").append(dlg.render().el);

    dlg
    .open();

  },

  /**
   * Returns the html populated with current data
   * @return {String}
   */
  render: function() {
    var template =  this.getTemplate('old_common/views/export_table_options')({
      formats:this.formats,
      url: this.baseUrl,
      isGeoreferenced: this.model.isGeoreferenced(),
      title: this.model.getUnqualifiedName()
    });

    this.$el.html(template);

    return this;

  },

  refresh: function() {
    this.$('.content').html(this.render());
  }

});
