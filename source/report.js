﻿var g_bLoaded = false; //needed because DOMContentLoaded gets called again when we modify the page
var g_mapETypeParam = { "ALL": "", "EINCR": 1, "EDECR": -1, "ENEW": 2 };
var g_iTabCur = null; //invalid initially
var ITAB_REPORT = 0;
var ITAB_BYUSER = 1;
var ITAB_BYBOARD = 2;
var g_colorDefaultOver="#B9FFA9";
var g_colorDefaultUnder = "#FFD5BD";
var g_bShowKeywordFilter = false;
var KEY_FORMAT_PIVOT_USER = "formatPivotUser";
var KEY_FORMAT_PIVOT_BOARD = "formatPivotBoard";
var KEY_bEnableTrelloSync = "bEnableTrelloSync";
var keybEnterSEByCardComments = "bEnterSEByCardComments"; //review zig reuse shared globals loader
var keyrgKeywordsforSECardComment = "rgKWFCC";
var g_postFixHeaderLast = " last"; //special postfix for column headers
var g_paramDontQuery = "dontQuery"; //1 when set
var g_paramFromMarkAllViewed = "fromMAV"; //1 when set

var g_cSyncSleep = 0;  //for controlling sync abuse
var g_bIgnoreEnter = false; //review zig
var FILTER_DATE_ADVANCED = "advanced";
var g_bNeedSetLastRowViewed = false;
var g_bAddParamSetLastRowViewedToQuery = false;
var g_rowidLastSyncRemember = -1;
var g_bBuildSqlMode = false;

var PIVOT_BY = {
    year: "year",
    month: "month",
    week: "",
    day: "day"
};

//cache formats to avoid overloading sync. "format" is saved to sync so short names there to reduce sync usage
var g_dataFormatUser = { key:KEY_FORMAT_PIVOT_USER, interval: null, cLastWrite:0, cCur: 0, format: { u: { c: g_colorDefaultUnder, v: null }, o: { c: g_colorDefaultOver, v: null } }};
var g_dataFormatBoard = { key:KEY_FORMAT_PIVOT_BOARD, interval: null, cLastWrite: 0, cCur: 0, format: { u: { c: g_colorDefaultUnder, v: null }, o: { c: g_colorDefaultOver, v: null } } };
var g_rgTabs = []; //tab data

function getCleanHeaderName(name) {
    if (!name)
        return "";
    var ret = name.split('\xa0')[0]; //hack: added &nbsp (g_hackPaddingTableSorter) to headers for tablesorter so remove them
    var iLast = ret.indexOf(g_postFixHeaderLast);
    if (iLast>0)
        ret = ret.substr(0, iLast);
    return ret;
}

function buildUrlFromParams(doc, params, bNoPopupMode) {
    var url = chrome.extension.getURL(doc);

    if (bNoPopupMode)
        params["popup"] = 0;
    else if (params["popup"] === undefined && g_bPopupMode)
        params["popup"] = "1";

    assert(!g_bBuildSqlMode);

    var c = 0;
    for (var i in params) {
        var val = params[i];
        if (val == "")
            continue;
        if (c == 0)
            url += "?";
        else
            url += "&";
        url += (i + "=" + encodeURIComponent(val));
        c++;
    }
    return url;
}

function updateUrlState(doc, params) {

    window.history.replaceState('data', '', buildUrlFromParams(doc, params));
}

function loadStorageGlobals(callback) {
    chrome.storage.sync.get([KEY_FORMAT_PIVOT_USER, KEY_FORMAT_PIVOT_BOARD, KEY_bEnableTrelloSync,keybEnterSEByCardComments, keyrgKeywordsforSECardComment], function (objs) {
		if (objs[KEY_FORMAT_PIVOT_USER] !== undefined)
			g_dataFormatUser.format = objs[KEY_FORMAT_PIVOT_USER];
		if (objs[KEY_FORMAT_PIVOT_BOARD] !== undefined)
		    g_dataFormatBoard.format = objs[KEY_FORMAT_PIVOT_BOARD];
		g_bEnableTrelloSync = objs[KEY_bEnableTrelloSync] || false;
		g_optEnterSEByComment.loadFromStrings(objs[keybEnterSEByCardComments], objs[keyrgKeywordsforSECardComment]);
		callback();
	});
}

function loadTabs(parent) {
    if (g_bBuildSqlMode)
        return;
	var tabs = parent.children(".agile_tabselector_list").find("a");
	var i = 0;
	for (; i < tabs.length; i++) {
		var elem = tabs.eq(i);
		g_rgTabs.push(elem.attr("href"));
		elem.off().click(function () {
			selectTab(-1, $(this).attr("href"));
			return false;
		});
	}
}

window.addEventListener('resize', function () {
    if (g_iTabCur!=null)
        selectTab(g_iTabCur, undefined, true);
    if (g_bBuildSqlMode) {
        setTimeout(function () {
            window.parent.resizeMe(document.body.clientHeight+60);
        }, 0);
    }
});

function selectTab(iTab, href, bForce) {
    if (iTab == null) {
        assert(g_iTabCur == null); //happens first time we init g_iTabCur
        iTab = 0;
    }

    if (iTab == g_iTabCur && !bForce)
        return; //ignore


    if (g_bBuildSqlMode) {
        g_iTabCur = iTab;
        return;
    }
	var params = getUrlParams();
	iTab = selectTabUI(iTab, href);
	g_iTabCur = iTab;
	if (params["tab"] != iTab) {
	    if (params["tab"] || iTab != 0) { //not just an optimization. Print (ctrl+print) causes a resize. updating the url causes the print dialog to go away in windows chrome.
	        params["tab"] = iTab;
	        updateUrlState("report.html", params);
	    }
	}
}

/* selectTabUI
 * 
 * select by iTab or href
 * to select by href pass -1 to iTab
 * RETURNS: iTab selected (useful for href case)
 **/
function selectTabUI(iTab, href) {
    if (g_bBuildSqlMode)
        return iTab;
	var i=0;
	var selector = null;
	var classSelected = "agile_report_tabselector_selected";
	var selectedOld=$("."+classSelected);
	selectedOld.removeClass(classSelected);
	//selectedOld.parent().css("border-color", "#E8EBEE");
	var elemsHide = null;
	selectedOld.parent().removeClass("agile_tabcell_selected");
	for (; i < g_rgTabs.length; i++) {
		var cur = g_rgTabs[i];
		if (i == iTab || (href && href == cur)) {
			iTab = i;//for he href case
			selector = cur;
		}
		else {
			if (elemsHide)
				elemsHide=elemsHide.add($(cur));
			else
				elemsHide = $(cur);
		}
	}
	if (selector) {
		var elem = $(selector);
		var selectedNew=$(".agile_tabselector_list").find("a[href='" + selector + "']");
		selectedNew.addClass(classSelected);
		selectedNew.parent().addClass("agile_tabcell_selected");
		setTimeout(function () {
			if (elemsHide)
				elemsHide.hide();
			var heightWindow=window.innerHeight;
			elem.show();
			var scroller = elem.find(iTab==0?".agile_tooltip_scroller" : ".agile_report_containerScroll");
			setScrollerHeight(heightWindow, scroller, scroller);
		}, 40); //this allows the tabs to refresh in case the tab is large (report tab)
	}
	return iTab;
}

function findMatchingBoards(term, autoResponse) {
    if (term == "*")
        term = "";
    var sql = "SELECT name FROM boards";
    var sqlPost=" ORDER BY LOWER(name) ASC";
    var paramsSql = [];

    if (term != "") {
        sql = sql + " where name LIKE ?";
        paramsSql.push("%" + term + "%");
    }
    getSQLReport(sql + sqlPost, paramsSql, function (response) {
        var rows = response.rows;
        if (response.status != STATUS_OK || !rows) {
            autoResponse([]);
            return;
        }
        
        var ret = [];
        var i = 0;
        for (; i < rows.length; i++) {
            ret.push(rows[i].name);
        }

        autoResponse(ret);
    });
}

function findMatchingLists(term, autoResponse) {
    if (term == "*")
        term = "";
    var nameBoard = $("#board").val().trim();
    var sql = null;
    var sqlPost = " ORDER BY LOWER(lists.name) ASC";
    var params = [];
    var cWhere = 0;
    if (nameBoard.length > 0) {
        sql = "SELECT distinct(lists.name) FROM lists join boards on lists.idBoard=boards.idBoard where boards.name LIKE ?";
        cWhere++;
        params.push("%" + nameBoard+"%");
    }
    else {
        sql = "SELECT distinct(lists.name) FROM lists";
    }

    if (term != "") {
        if (cWhere == 0) {
            sql = sql + " WHERE";
        }
        else {
            sql = sql + " AND";
    }
        cWhere++;
        sql = sql + " lists.name LIKE ?";
        params.push("%" + term + "%");
    }

    getSQLReport(sql + sqlPost, params, function (response) {
        var rows = response.rows;
        if (response.status != STATUS_OK || !rows) {
            autoResponse([]);
            return;
        }

        var ret = [];
        var i = 0;
        for (; i < rows.length; i++) {
            ret.push(rows[i].name);
        }

        autoResponse(ret);
    });
}

function findMatchingUsers(term, autoResponse) {
    if (term == "*")
        term = "";
    var sql = "SELECT distinct(user) FROM history";
    var sqlPost=" ORDER BY LOWER(user) ASC";
    var params = [];
    if (term!="") {
        sql = sql + " where user LIKE ?";
        params.push("%" + term + "%");
    }
    sql = sql + sqlPost;
    getSQLReport(sql, params, function (response) {
        var rows = response.rows;
        if (response.status != STATUS_OK || !rows) {
            autoResponse([]);
            return;
        }

        var ret = [];
        var i = 0;
        for (; i < rows.length; i++) {
            ret.push(rows[i].user);
        }

        autoResponse(ret);
    });
}


function findMatchingWeeks(term, autoResponse) {
    if (term == "*")
        term = "";
    var date = new Date();
    var rg = [];
    var daysDelta = 7;
    for (var i = 0; i < 53; i++) {
        rg.push(getCurrentWeekNum(date));
        date.setDate(date.getDate() - daysDelta);
    }
    autoResponse(term==""?rg : rg.filter(function (item) {
        return (item.indexOf(term)>=0);
    }));
}

function findMatchingMonths(term, autoResponse) {
    if (term == "*")
        term = "";
    var date = new Date();
    var rg = [];
    var daysDelta = 7;
    date.setDate(1);
    for (var i = 0; i < 24; i++) {
        rg.push(getCurrentMonthFormatted(date));
        date.setMonth(date.getMonth() - 1);
    }
    
    autoResponse(term==""?rg :rg.filter(function (item) {
        return (item.indexOf(term) >= 0);
    }));
}

var g_portBackground = null;

function setupNotifications() {
    if (g_portBackground != null)
        return;
    g_portBackground = chrome.runtime.connect({ name: "registerForChanges" });
    g_portBackground.onMessage.addListener(function (msg) {
        if (msg.status != STATUS_OK)
            return;

        if (msg.event == EVENTS.DB_CHANGED) {
            hiliteOnce($("#agile_reload_page").show(),10000);
        }
    });
}


document.addEventListener('DOMContentLoaded', function () {
	//chrome Content Security Policy (CSP) needs DOMContentLoaded
	if (g_bLoaded)
		return;
	g_bLoaded = true;
	var params = getUrlParams();
	g_bPopupMode = (params["popup"] == "1");
	g_bBuildSqlMode = (params["getsql"] == "1");
	if (g_bBuildSqlMode) {
	    $("#checkNoCrop").parent().hide();
	    $("#tabs").hide();
	    $("#agile_title_header_report").hide();
	    $("#groupBy").parent().hide();
	    $("#pivotBy").parent().hide();
	    $("#orderBy").parent().hide();
	    $("#board").parent().hide();
	    $("body").css("margin-top", "0px");
	    $("#report_top_section").css("margin-bottom", "0px");

	}

	loadTabs($("#tabs"));

	if (g_bPopupMode) {
	    $("#agile_title_header_report").hide();
	    $("body").height(450); //these two are also duplicated in report.html body so that reports opened from the popup (spent this week) has the right size (prevent flicker)
	    $("body").width(620);
	    var dockOut = $("#dockoutImg");
	    dockOut.attr("src", chrome.extension.getURL("images/dockout.png"));
	    dockOut.show();
	    dockOut.css("cursor", "pointer");
	    dockOut.off().click(function () { //cant use setPopupClickHandler because url could have changed if user navigated inside 
	        var urlDockout = buildUrlFromParams("report.html", getUrlParams(), true);
	        chrome.tabs.create({ url: urlDockout });
	        return false;
	    });


	    var back = $("#backImg");
	    back.attr("src", chrome.extension.getURL("images/back.png"));
	    back.show();
	    back.css("cursor", "pointer");
	    back.off().click(function () {
	        window.history.back();
	        return false;
	    });

	}

	openPlusDb(function (response) {
	    if (response.status != STATUS_OK) {
	        return;
	    }
	    if (!g_bBuildSqlMode)
	        setupNotifications();

	    $("#agile_reload_page_link").off().click(function (e) {
	        e.preventDefault();
	        var params = getUrlParams();
	        if (g_bAddParamSetLastRowViewedToQuery)
	            params["setLastRowViewed"] = "true";
	        configReport(params, true);

	    });

	    function addFocusHandler(elem) {
	        var specialAll = "*"; //wasted time getting .autocomplete to work on "" so this hack worksarround it
	        elem.off("focus.plusForTrello").on("focus.plusForTrello", function () {
	            if (this.value == "" || this.value == specialAll)
	                $(this).autocomplete("search", specialAll);
	        });
	    }

	    addFocusHandler($("#board").autocomplete({
	        delay: 0,
	        minChars: 0,
	        source: function (request, response) {
	            findMatchingBoards(request.term, response);
	        }
	    }));

	    addFocusHandler($("#user").autocomplete({
	        delay: 0,
	        minChars: 0,
	        source: function (request, response) {
	            findMatchingUsers(request.term, response);
	        }
	    }));

	    addFocusHandler($("#list").autocomplete({
	        delay: 0,
	        minChars: 0,
	        source: function (request, response) {
	            findMatchingLists(request.term, response);
	        }
	    }));


	    addFocusHandler($("#weekStart").autocomplete({
	        delay: 0,
	        minChars: 0,
	        source: function (request, response) {
	            findMatchingWeeks(request.term, response);
	        }
	    }));

	    addFocusHandler($("#weekEnd").autocomplete({
	        delay: 0,
	        minChars: 0,
	        source: function (request, response) {
	            findMatchingWeeks(request.term, response);
	        }
	    }));

	    addFocusHandler($("#monthStart").autocomplete({
	        delay: 0,
	        minChars: 0,
	        source: function (request, response) {
	            findMatchingMonths(request.term, response);
	        }
	    }));

	    addFocusHandler($("#monthEnd").autocomplete({
	        delay: 0,
	        minChars: 0,
	        source: function (request, response) {
	            findMatchingMonths(request.term, response);
	        }
	    }));

	    loadStorageGlobals(function () {
	        configAllPivotFormats();
	        loadReport(params);
	    });
	});
});

var g_cacheCells = {}; //cache cells to speed up formatting when user changes the ranges

function configPivotFormat(elemFormat, dataFormat, tableContainer, iTab) {
	var underElem = elemFormat.children(".agile_format_under");
	var overElem = elemFormat.children(".agile_format_over");
	var colorUnderElem = elemFormat.children(".agile_colorpicker_colorUnder");
	var colorOverElem = elemFormat.children(".agile_colorpicker_colorOver");
	var colorNormal = "#FFFFFF"; //review zig: get it from css
	var comboFormat = elemFormat.children(".agile_report_optionsFormat");
	var copyWindow = elemFormat.find(".agile_drilldown_select");

	if (copyWindow.length > 0) {
		copyWindow.attr("src", chrome.extension.getURL("images/copy.png"));
		copyWindow.attr("title", "Click to copy table to your clipboard, then paste elsewhere (email, spreadsheet, etc.)");
		copyWindow.off().click(function () {
			var table = tableContainer;
			selectElementContents(table[0]);
		});
	}

	underElem.val(dataFormat.format.u.v);
	colorUnderElem.val(dataFormat.format.u.c);
	overElem.val(dataFormat.format.o.v);
	colorOverElem.val(dataFormat.format.o.c);
	comboFormat.val(dataFormat.format.f || "smooth");

	function applyFormat(bFirstTime) {
	    if (bFirstTime)
	        applyFormatWorker(bFirstTime); //review zig: should be ok in setTimeout but here to reduce risk of making this change.
        else
	        setTimeout(function () { applyFormatWorker(bFirstTime); }, 10);
	    }

	function applyFormatWorker(bFirstTime) {
		var weekCur = getCurrentWeekNum(new Date());
		var strUnder = underElem.val();
		var strOver = overElem.val();
		var valUnder = (strUnder.length ==0? null : parseFloat(strUnder));
		var valOver = (strOver.length ==0? null : parseFloat(strOver));
		var colorUnder = colorUnderElem.val();
		var colorOver = colorOverElem.val();
		var formatType = comboFormat.val();
		var bNoFormat = formatType == "off";
		var bStrictFormat = formatType == "strict";
		var rgbUnder = rgbFromHex(colorUnder);
		var rgbOver = rgbFromHex(colorOver);

		if (bNoFormat) {
			savePivotFormat(dataFormat, colorUnder, colorOver, valUnder, valOver, formatType);
			valUnder = null;
			valOver = null;
			underElem.prop('disabled', true);
			overElem.prop('disabled', true);

		}
		else {
			savePivotFormat(dataFormat, colorUnder, colorOver, valUnder, valOver, formatType);
			underElem.removeAttr('disabled');
			overElem.removeAttr('disabled');
		}

		if (bFirstTime && (bNoFormat || (valUnder === null && valOver === null)))
		    return; //performance

		if (g_iTabCur != null && g_iTabCur != iTab)
		    setTimeout(function () { workerCells(); }, 300);
		else
		    workerCells();

		function workerCells() {
		    var cells = g_cacheCells[dataFormat.key];
		    if (cells === undefined) {
		        cells = tableContainer.find(".agile_pivot_value");
		        if (!bFirstTime)
		            g_cacheCells[dataFormat.key] = cells; //cache when called from format change so its fast as the user changes values
		    }

		    cells.each(function () {
		        var bUsedUnder = false;
		        var rgb = null;
		        var el = $(this);
		        var val = parseFloat(el.text());
		        var color = colorNormal;

		        if (el.data("agile_total_row") == "true") {
		            //until the week is done doesnt make sense to color under
		            color = "#FFFFFF";
		            rgb = null; //so it resets below
		        }
		        else if (valUnder == null && valOver == null)
		            color = colorNormal;
		        else if (valUnder != null && val < valUnder) {
		            color = colorUnder;
		            bUsedUnder = true;
		        }
		        else if (valOver != null && val > valOver)
		            color = colorOver;
		        else if (!bStrictFormat && (valUnder != null || valOver != null)) {
		            //in between
		            var distance = 0;
		            if (valUnder != null && valOver != null)
		                distance = valOver - valUnder;
		            else if (valUnder != null)
		                distance = valUnder;
		            else
		                distance = valOver;
		            distance = distance / 4;

		            var rgbLeft = null;
		            var rbgRight = null;
		            var rgbWhite = rgbFromHex("#FFFFFF");
		            var percentSpread = 0.7; //% of the color range to use.
		            //used to leave 1/2 of the difference on each side so its easier to distinguish the actual boundary
		            var diff = 0;
		            if (valUnder != null && (val - valUnder <= distance)) {
		                rgbLeft = rgbUnder;
		                rgbRight = rgbWhite;
		                diff = val - valUnder;
		                bUsedUnder = true;
		            } else if (valOver != null && (valOver - val <= distance)) {
		                rgbLeft = rgbOver;
		                rgbRight = rgbWhite;
		                diff = valOver - val;
		            }

		            if (rgbLeft == null) {
		                rgb = rgbWhite;
		            } else {
		                rgb = [];
		                var iColor = 0;
		                var rate = (1 - percentSpread) / 2 + (diff / distance) * percentSpread;
		                for (; iColor < 3; iColor++)
		                    rgb.push(Math.round(rgbLeft[iColor] + (rgbRight[iColor] - rgbLeft[iColor]) * rate));
		            }
		            color = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
		        }

		        if (bUsedUnder && el.data("agile_week") == weekCur) {
		            //until the week is done doesnt make sense to color under
		            color = "#FFFFFF";
		            rgb = null; //so it resets below
		        }

		        el.css("background", color);
		        if (rgb == null)
		            rgb = rgbFromHex(color);
		        var colorText = "black";
		        if (rgb) {
		            if (el.hasClass("agile_pivotCell_Zero"))
		                colorText = color; //prevent filling report with zeros which clutter it. value is there but with color equal to background
		            else {
		                var sum = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722; //standard luminance. This will never be perfect a user's gamma/calibration is never the same.
		                if (sum < 128)
		                    colorText = "white";
		            }
		        }
		        el.css("color", colorText);
		    });
		}
	}

	applyFormat(true);
	comboFormat.off().change(function () {
	    applyFormat(false);
	});

	function onEditsChange() {
	    applyFormat(false);
	}

	underElem.off().on('input', onEditsChange);
	overElem.off().on('input', onEditsChange);
	colorUnderElem.off().on('input', onEditsChange);
	colorOverElem.off().on('input', onEditsChange);
}

function rgbFromHex(hex) {
	var regexRGB = /^#([\da-fA-F]{2})([\da-fA-F]{2})([\da-fA-F]{2})/;
	var rgb = regexRGB.exec(hex);
	if (!rgb)
		return null;
	return [parseInt(rgb[1], 16), parseInt(rgb[2], 16), parseInt(rgb[3], 16)];
}

function savePivotFormat(dataFormat, colorUnder, colorOver, valUnder, valOver, formatType) {
	var before = JSON.stringify(dataFormat.format);
	var obj = dataFormat.format.u;
	obj.c = colorUnder;
	obj.v = valUnder;
	obj = dataFormat.format.o;
	obj.c = colorOver;
	obj.v = valOver;
	dataFormat.format.f = formatType;
	var after = JSON.stringify(dataFormat.format);
	var waitNormal = 4000;

	function saveToSync(bNow) {
		//look until it stabilizes, otherwise dont sync it this time.
		var lastFormat = JSON.stringify(dataFormat.format);
		var wait = waitNormal*3/4;
		if (bNow && bNow == true)
			wait = 200;

		setTimeout(function () {
			if (!bNow && g_cSyncSleep > 0) {
				g_cSyncSleep--;
				return;
			}
			var currentFormat = JSON.stringify(dataFormat.format);
			if (currentFormat != lastFormat)
				return;
			var pair = {};
			var cCur = dataFormat.cCur; //separate from global format
			pair[dataFormat.key] = dataFormat.format;
			chrome.storage.sync.set(pair, function () {
				if (chrome.runtime.lastError === undefined)
					dataFormat.cLastWrite = Math.max(dataFormat.cLastWrite, cCur);
				else
					g_cSyncSleep = 5; //will sleep next x cicles
			});
		}, wait);
	}

	if (before != after) {
		dataFormat.cCur++;
		if (dataFormat.interval == null) {
			saveToSync(true); //first change saves right away
			dataFormat.interval = setInterval(function () {
				if (dataFormat.cCur != dataFormat.cLastWrite)
					saveToSync(false);
			}, waitNormal); //keep sync quotas happy
		}
	}
}

function invertColor(hexTripletColor) {
	var color = hexTripletColor;
	color = color.substring(1);           // remove #
	color = parseInt(color, 16);          // convert to integer
	color = 0xFFFFFF ^ color;             // invert three bytes
	color = color.toString(16);           // convert to hex
	color = ("000000" + color).slice(-6); // pad with leading zeros
	color = "#" + color;                  // prepend #
	return color;
}

function getParamAndPutInFilter(elem, params, name, valDefault) {
	var value = params[name];
	var str = "";
	var bShowHide = (valDefault == "showhide");
	if (!bShowHide)
		str = valDefault;
	if (value && value != "")
		str = decodeURIComponent(value);
	if (name.indexOf("check") == 0)
	    elem[0].checked = (str == "true");
	else {
	    elem.val(str);
	    if (elem.val() != str) {
	        //allow user to type a random filter from the url
	        if (elem.is("select")) {
	            elem.append($(new Option(str, str)));
	            elem.val(str);
	        }
	    }
	}
	if (bShowHide) {
		var parent = elem.parent();
		if (str.length > 0)
			parent.show();
		else {
			parent.hide();
		}
	}

	return str;
}

function loadReport(params) {
	selectTab(params["tab"] || null);
	$("#divMain").show();
	var bDontQuery = (params[g_paramDontQuery] == "1");
	var bFromMarkAllViewed = (params[g_paramFromMarkAllViewed] == "1");
	var sinceSimple = "";
	if (params.weekStartRecent == "true") {
		sinceSimple = "w-4";
	}

	if (params.setLastRowViewed == "true")
	    g_bNeedSetLastRowViewed = true;
	else
	    g_bNeedSetLastRowViewed = false;

	var bShowZeroR = true;
	if (params.showZeroR === undefined) {
	    if (params.orderBy == "remain")
	        bShowZeroR = false;
	}
	else {
	    bShowZeroR = (params.showZeroR == "true");
	}

	var comboSinceSimple = $("#sinceSimple");
	var comboOrderBy = $('#orderBy');
	var groupDateAdvanced = $("#groupDateAdvanced");

	//note: "all" in comboSinceSimple has value "" thus gets selected by default when there is no param
	function updateDateState() {
		if (comboSinceSimple.val() == FILTER_DATE_ADVANCED) {
		    groupDateAdvanced.show();
			selectTab(g_iTabCur); //body size can change when showing fields
		} else {
			groupDateAdvanced.hide();
			selectTab(g_iTabCur); //body size can change when hiding fields
		}
	}

	comboSinceSimple.off().change(function () {
		updateDateState();
	});

	comboOrderBy.off().change(function () {
		if (comboOrderBy.val() == "remain") {
			comboSinceSimple.val("");
			hiliteOnce(comboSinceSimple);
			updateDateState();

		}
	});

	var comboKeyword = $("#keyword");
	g_bShowKeywordFilter = false;
	if (g_optEnterSEByComment.IsEnabled()) {
	    var rgkeywords = g_optEnterSEByComment.rgKeywords;
	    function addKW(str, val, bSelected) {
	        var optAdd = new Option(str, val);
	        comboKeyword.append($(optAdd));
	        if (bSelected)
	            optAdd.selected = true;
	    }
	    addKW("All", "", true);
	    for (var i = 0; i < rgkeywords.length; i++)
	        addKW(rgkeywords[i], rgkeywords[i]);

	    if (g_optEnterSEByComment.getAllKeywordsExceptLegacy().length > 1)
	        g_bShowKeywordFilter = true;
	}

	var elems = {
	    keyword: "showhide", groupBy: "", pivotBy: "", orderBy: "date", showZeroR: "", sinceSimple: sinceSimple, weekStart: "", weekEnd: "",
	    monthStart: "", monthEnd: "", user: "", board: "", list: "", card: "", comment: "", eType: "all", archived: "0", deleted: "0",
	    idBoard: (g_bBuildSqlMode?"":"showhide"), idCard: "showhide", checkNoCrop: "false", afterRow: "showhide"
	};
	for (var iobj in elems) {
		var elemCur = $("#" + iobj);
		elemCur.off("keypress.plusForTrello").on("keypress.plusForTrello",function (event) {
			if (g_bIgnoreEnter)
				return;
			var keycode = (event.keyCode ? event.keyCode : event.which);
			if (keycode == '13') { //enter key
				onQuery();
			}
		});
		getParamAndPutInFilter(elemCur, params, iobj, elems[iobj]);
		if ((iobj == "idBoard" || iobj == "idCard") && elems[iobj].length > 0)
			hiliteOnce(elemCur);
	}

	if (g_bShowKeywordFilter)
	    comboKeyword.parent().show();
	else {
	    $("#orderBy option[value*='keyword']").remove();
	    $("#groupBy option[value*='keyword']").remove();
	}

	if (!g_bEnableTrelloSync) {
	    $("#list").prop('disabled', true).prop("title", "Disabled until you enable Sync from Plus help.");
	    $("#groupBy option[value*='nameList']").remove();
	}

	if (g_bPopupMode) {
	    $("#archived").parent().hide();
	    $("#deleted").parent().hide();
	}
	else {
	    $("#archived").parent().show();
	    $("#deleted").parent().show();
	    if (!g_bEnableTrelloSync) {
	        $("#archived").prop('disabled', true).addClass("agile_background_disabled").prop("title", strAppendNoSync);
	        $("#deleted").prop('disabled', true).addClass("agile_background_disabled").prop("title",  strAppendNoSync);
	    }
	}

	updateDateState();
	var btn = $("#buttonFilter");

	function onQuery(bFirstTime) {
	    if (bFirstTime && g_bBuildSqlMode)
	        bFirstTime = false;

	    g_cacheCells = {}; //clear cache
		if (false) { //review zig: figure out how to make this work.
			var iForms = 0;
			var forms = $("form");
			function handleFormsSubmit(iform, forms) {
				setTimeout(function () {
					document.forms[forms[iform].name].submit();
					if (iform + 1 < forms.length)
						handleFormsSubmit(iform + 1, forms);
				}, 100);
			}

			handleFormsSubmit(0, forms);
		}

		if (!g_bBuildSqlMode) {
		    setBusy(true, btn);
		    btn.attr('disabled', 'disabled');
		}
		if (bFirstTime)
			btn.text("•••");
		for (var iobj in elems) {
			if (iobj == "tab")
				continue;
			var elemCur = $("#" + iobj);
			if (iobj.indexOf("check") == 0)
				elems[iobj] = (elemCur[0].checked ? "true" : "false"); //keep it a string so its similar to the other properties
			else {
				elems[iobj] = elemCur.val();
				//clear advanced date filters if a simple one is being used. Do it on query and not on list change so user can experient with the ui without losing what was typed.
				if (iobj == "sinceSimple" && elems[iobj] != FILTER_DATE_ADVANCED)
					groupDateAdvanced.find("input").val(""); //review: implement a "postGet" event defined per field so each field handles this
			}
		}
		assert(g_iTabCur != null);
		elems["tab"] = g_iTabCur;

		if (bFirstTime && !g_bPopupMode) {
			//these set of timeouts could be done all together but the GUI wont update instantly.
			//handles this case: 1) make a huge report, 2) view by User, 3) change the filter and click Query again.
			//without this, the pivot view would take a long time to clear because its waiting for the report to clear (which can take a few seconds with 10,000 rows).
			setTimeout(function () {
				$(".agile_report_container_byUser").empty().html(" •••");
				$(".agile_report_container_byBoard").empty().html(" •••");
				setTimeout(function () {
					$(".agile_topLevelTooltipContainer").empty().html(" •••");
					setTimeout(function () {
						configReport(elems);
					}, 1);
				}, 1);
			}, 1);
		} else {
		    configReport(elems, !bFirstTime && !g_bBuildSqlMode);
		}
	}
	btn.off().click(function () {
		onQuery();
	});

	if (!g_bBuildSqlMode && Object.keys(params).length > 0 && !bDontQuery) { //dont execute query automatically
	    if (g_bPopupMode)
	        onQuery(true);
        else
	        setTimeout(function () { onQuery(true); }, 10);
	}
	else {
	    if (!g_bBuildSqlMode) {
	        delete params[g_paramDontQuery];
	        delete params[g_paramFromMarkAllViewed];
	        updateUrlState("report.html", params);
	    }
	    resetQueryButton(btn);
	    if (bFromMarkAllViewed)
	        $("#reportBottomMessage").show().html("s/e rows marked viewed. Close this window or query a new report.");
	}
}


function showError(err) {
    alert("Plus for Trello:" + err);
}

function completeString(str, pattern) {
	var c = pattern.length;
	while (str.length < c)
		str = str + pattern.charAt(str.length);
	return str;
}

function buildSqlParam(param, params, sqlField, operator, state, completerPattern, btoUpper) {
    if (btoUpper === undefined)
        btoUpper = true;
	var val = params[param];
	if (val == "")
		return "";

	var bString = (typeof (val) == 'string');
	if (completerPattern)
		val = completeString(val, completerPattern);
	var sql = "";
	if (bString && btoUpper)
		val = val.toUpperCase();

	//review zig: need more generic way to interpret parameters without hardcoding all here
	if (param == "eType")
		val = g_mapETypeParam[val];

	if (param == "sinceSimple") {
		var parts = val.split("-");
		if (parts.length < 2)
			return "";	 //ignore if value is not in tuple format. caller deals with those (advanced, all, etc)
		var now = new Date();
		now.setHours(0, 0, 0, 0);
		var delta = (parseInt(parts[1], 10)|| 0)-1;
		if (parts[0] == "W")
		    delta = (delta * 7) + DowMapper.posWeekFromDow(now.getDay());

		now.setDate(now.getDate() - delta);
		val = Math.round(now.getTime() / 1000); //db date are in seconds
	}

	if (param == "archived") {
	    val = parseInt(val, 10) || 0;
	    if (val < 0) //"All" is -1
	        return "";
	}

	if (param == "deleted") {
	    val = parseInt(val, 10) || 0;
	    if (val < 0) //"All" is -1
	        return "";
	}

	bString = (typeof (val) == 'string'); //refresh

	if (state.cFilters == 0)
		sql += " WHERE ";
	else
		sql += " AND ";

	var decorate = "";
	var opNot = ""; //by default is not negated

	if (operator.toUpperCase() == "LIKE") {
	    decorate = "%";
	    if (bString && val.charAt(0) == "!") {
	        opNot = "NOT ";
	        val = val.substr(1);
	    }
	}
	if (bString && btoUpper)
	    sql += ("UPPER(" + sqlField + ") " + opNot + operator + " ?");
	else
		sql += (sqlField + " " + operator + " ?");
	state.cFilters++;
	state.values.push(decorate==""? val : decorate + val + decorate);
	return sql;
}

function buildSql(elems) {

	function buildAllParams(state) {
        var sql="";
	    sql += buildSqlParam("sinceSimple", elems, "date", ">=", state);
	    sql += buildSqlParam("weekStart", elems, "week", ">=", state);
	    sql += buildSqlParam("weekEnd", elems, "week", "<=", state, "9999-W99");
	    sql += buildSqlParam("monthStart", elems, "month", ">=", state);
	    sql += buildSqlParam("monthEnd", elems, "month", "<=", state, "9999-99");
	    sql += buildSqlParam("user", elems, "user", "LIKE", state);
	    sql += buildSqlParam("board", elems, "nameBoard", "LIKE", state);
	    sql += buildSqlParam("list", elems, "nameList", "LIKE", state);
	    sql += buildSqlParam("card", elems, "nameCard", "LIKE", state);
	    sql += buildSqlParam("comment", elems, "comment", "LIKE", state);
	    sql += buildSqlParam("eType", elems, "eType", "=", state);
	    sql += buildSqlParam("archived", elems, "bArchivedCB", "=", state);
	    sql += buildSqlParam("deleted", elems, "bDeleted", "=", state);
	    sql += buildSqlParam("idBoard", elems, "idBoardH", "=", state);
	    sql += buildSqlParam("idCard", elems, "idCardH", "=", state);
	    sql += buildSqlParam("afterRow", elems, "rowid", ">", state, null, false);
	    sql += buildSqlParam("keyword", elems, "keyword", "LIKE", state);
	    return sql;
	}

    //note: the query itself doesnt group because we later do need the entire history to fill the pivot tabs.
	var groupBy = elems["groupBy"] || "";
	var sql = "select H.rowid as rowid, H.keyword as keyword, H.user as user, H.week as week, H.month as month, H.spent as spent, H.est as est, \
                CASE WHEN (H.eType="+ ETYPE_NEW + ") then H.est else 0 end as estFirst, \
                H.date as date, H.comment as comment, H.idCard as idCardH, H.idBoard as idBoardH, L.name as nameList, C.name as nameCard, B.name as nameBoard, H.eType as eType, \
                CASE WHEN (C.bArchived+B.bArchived+L.bArchived)>0 then 1 else 0 end as bArchivedCB, C.bDeleted as bDeleted \
                FROM HISTORY as H \
                JOIN CARDS as C on H.idCard=C.idCard \
                JOIN LISTS as L on C.idList=L.idList \
                JOIN BOARDS B on H.idBoard=B.idBoard";

	var state = { cFilters: 0, values: [] };
	var sqlParams = buildAllParams(state);
	sql += sqlParams;


    //note: currently week/month isnt stored in cards table thus we cant filter by these.
    //can be fixed but its an uncommon use of filters where user also wants to include cards without s/e
	var groupByLower = groupBy.toLowerCase();
	if (groupBy != "" && groupByLower.indexOf("date") < 0 && groupByLower.indexOf("user") < 0 &&
        !elems["weekStart"] && !elems["weekEnd"] &&
        !elems["monthStart"] && !elems["monthEnd"]) {
	    assert(!g_bBuildSqlMode);

	    //note: use -1 as rowid so when doing a "new s/e rows" report and a group is used, this union wont appear.
	    sql += " UNION ALL \
                select -1 as rowid, '' as keyword, '' as user, '' as week, '' as month, 0 as spent, 0 as est, \
                0 as estFirst, \
                cast(strftime('%s',C.dateSzLastTrello) as INTEGER) as date , '' as comment, C.idCard as idCardH, C.idBoard as idBoardH, L.name as nameList, C.name as nameCard, B.name as nameBoard, " + ETYPE_NONE + " as eType, \
                CASE WHEN (C.bArchived+B.bArchived+L.bArchived)>0 then 1 else 0 end as bArchivedCB, C.bDeleted as bDeleted \
                FROM CARDS as C \
                JOIN LISTS as L on C.idList=L.idList \
                JOIN BOARDS B on C.idBoard=B.idBoard";
	    sql += sqlParams;
	    var cValues = state.values.length;
	    for (var iValues = 0; iValues < cValues; iValues++)
	        state.values.push(state.values[iValues]);
	}

	
	sql += " order by date " + (g_bBuildSqlMode ? "ASC" : "DESC");

	return { sql: sql, values: state.values};
}

function configReport(elemsParam, bRefreshPage, bOnlyUrl) {
	var elems = cloneObject(elemsParam);
	if (elems["eType"] == "all") //do this before updateUrlState so it doesnt include this default in the url REVIEW zig change so its elem value IS "" (see sinceDate)
		elems["eType"] = ""; //this prevents growing the URL with the default value for eType

	if (elems["deleted"] == "")
	    elems["deleted"] = "0"; //default to "Not deleted"

	if (elems["archived"] == "")
	    elems["archived"] = "0"; //default to "Not archived"

	if (elems["checkNoCrop"] == "false")
	    elems["checkNoCrop"] = ""; //ditto like eType
	if (!g_bBuildSqlMode) {
	    if (g_bAddParamSetLastRowViewedToQuery) {
	        elems["setLastRowViewed"] = "true";
	    }
	    updateUrlState("report.html", elems);
	}

	if (bOnlyUrl)
	    return;
	if (!g_bBuildSqlMode)
	    setBusy(true);
	if (bRefreshPage) {
	    assert(!g_bBuildSqlMode);
		//we do this because jquery/DOM accumulates RAM from old table contents, which also take a long time to clear.
		//instead, just reload the page. clears RAM and speeds it up.
		location.reload(true);
		return;
	}

	
	var sqlQuery = buildSql(elems);
	if (g_bBuildSqlMode) {
	    window.parent.setSql(sqlQuery.sql, sqlQuery.values);
	    return;
	}

	openPlusDb(
			function (response) {
				if (response.status != STATUS_OK) {
					showError(response.status);
					return;
				}
				getSQLReport(sqlQuery.sql, sqlQuery.values,
					function (response) {
						var rows = response.rows;
						try {
							setReportData(rows, elems["checkNoCrop"] == "true", elems);
						}
						catch (e) {
							var strError = "error: " + e.message;
							showError(strError);
						}
					});
			});
}

function resetQueryButton(btn) {
	setBusy(false);
	setBusy(false, btn);
	btn.removeAttr('disabled');
	btn.text("Query");
}

function setReportData(rowsOrig, bNoTruncate, urlParams) {
	var rowsGrouped = rowsOrig;

	var groupBy = urlParams["groupBy"];
	var orderBy = urlParams["orderBy"];

	if (groupBy.length > 0 || (orderBy.length > 0 && orderBy != "date"))
	    rowsGrouped = groupRows(rowsOrig, groupBy, orderBy);


	var bShowMonth = (urlParams["sinceSimple"].toUpperCase() == FILTER_DATE_ADVANCED.toUpperCase() && (urlParams["monthStart"].length > 0 || urlParams["monthEnd"].length > 0));
	var html = getHtmlDrillDownTooltip(rowsGrouped, bNoTruncate, groupBy, orderBy, urlParams["eType"], urlParams["archived"], urlParams["deleted"], bShowMonth);
	var parentScroller = $(".agile_report_container");
	var container = makeReportContainer(html, 1300, true, parentScroller, true);
	var tableElem = $(".tablesorter");
	if (tableElem.length > 0 && rowsGrouped.length>0) {
	    var sortList = null;
	    if (orderBy) {
	        var elemMatch = $('#orderBy option').filter(function () { return $(this).val() == orderBy; });
	        if (elemMatch.length > 0) {
	            var textSort = getCleanHeaderName(elemMatch[0].innerText);
	            var ascdesc=0;
	            if (orderBy == "date" || typeof (rowsGrouped[0][orderBy]) != "string")
	                ascdesc = 1;
	            sortList = [[textSort,ascdesc]];
	        }
	    }

	    tableElem.tablesorter({
	        sortList: sortList //note the modified tablesorter only sets headers here, wont sort (again) the list
	    });
	    
	    tableElem.bind("sortEnd", function () {
	        var elem = this;
	        if (elem && elem.config && elem.config.sortList && elem.config.headerList) {
	            var index = elem.config.sortList[0][0]; //supports first sort only
	            var txtHeader = getCleanHeaderName(elem.config.headerList[index].innerText);
	            var valMatch = $('#orderBy option').filter(function () { return getCleanHeaderName($(this).html()) == txtHeader; }).val();
	            if (valMatch) {
	                var valMatchClean = getCleanHeaderName(valMatch);
	                $('#orderBy').val(valMatchClean);
	                var params = getUrlParams();
	                params["orderBy"] = valMatchClean;
	                configReport(params, false, true);
	            }
	        }
	    });
	}
	    
	
	var btn = $("#buttonFilter");
	resetQueryButton(btn);
	fillPivotTables(rowsOrig, $(".agile_report_container_byUser"), $(".agile_report_container_byBoard"), urlParams, bNoTruncate);
	selectTab(g_iTabCur); //select again to adjust height
	if (g_bNeedSetLastRowViewed) {
	    g_bNeedSetLastRowViewed = false;
	    configureLastViewedRowButton();
	    g_bAddParamSetLastRowViewedToQuery = true;
	}
}

function configureLastViewedRowButton() {
    var keyLastSyncViewed = "rowidLastHistorySyncedViewed";

    chrome.storage.local.get([keyLastSyncViewed], function (obj) {
        var rowidLastSync = obj[keyLastSyncViewed];
        
        if (rowidLastSync !== undefined && g_rowidLastSyncRemember < 0)
            g_rowidLastSyncRemember = rowidLastSync; //needed when user already marked all as viewed, so there are no rows.
        var buttonMarkRead = $("#buttonMarkallRead");
        buttonMarkRead.show();
        $("#afterRow").prop('disabled', true);
        buttonMarkRead.off().click(function () {
            buttonMarkRead.attr('disabled', 'disabled');
            setLastViewedRow();
        });
    });
}

function setLastViewedRow() {
    var keyLastSyncViewed = "rowidLastHistorySyncedViewed";

    function finish() {
        sendExtensionMessage({ method: "updatePlusIcon" }, function (response) { });
        var params = {};
        g_bAddParamSetLastRowViewedToQuery = false;
        params[g_paramDontQuery] = "1";
        params[g_paramFromMarkAllViewed] = "1";
        params["sinceSimple"] = "w-4";
        configReport(params, true);
    }

    chrome.storage.local.get([keyLastSyncViewed], function (obj) {
        var rowidLastSyncViewed = obj[keyLastSyncViewed];
        //prevent an old report from overwritting a newer viewed row
        if (rowidLastSyncViewed !== undefined && rowidLastSyncViewed >= g_rowidLastSyncRemember) {
            finish();
            return;
        }

        var pair = {};
        pair[keyLastSyncViewed] = g_rowidLastSyncRemember;
        chrome.storage.local.set(pair, function () {
            finish();
        });
    });
}

function fillPivotTables(rows, elemByUser, elemByBoard, urlParams, bNoTruncate) {
    var pivotBy = urlParams["pivotBy"];
    var bPivotByMonth = (pivotBy == PIVOT_BY.month);
    var bPivotByWeek = (pivotBy == PIVOT_BY.week);
    var bPivotByDate = (pivotBy == PIVOT_BY.day);
    var bPivotByYear = (pivotBy == PIVOT_BY.year);
    var tables = calculateTables(rows, pivotBy);
	//{ header: header, tips: tips, byUser: rgUserRows, byBoard: rgBoardRows };
	var parent = elemByUser.parent();
	var dyTop = 70;
	var strTh = "<th class='agile_header_pivot agile_pivotCell'>";
	var strTd = '<td class="agile_nowrap agile_pivotCell">';
	var strTable = "<table class='agile_table_pivot' cellpadding=2 cellspacing=0>";
	var elemTableUser = $(strTable);
	var trUser = $("<tr>");
	var elemTableBoard = $(strTable);
	var trBoard = $("<tr>");
	var replaces = [];
	var pivotStart = "weekStart";
	var pivotEnd = "weekEnd";

	if (bPivotByMonth || bPivotByYear) {
	    pivotStart = "monthStart";
	    pivotEnd = "monthEnd";
	}

	function handleClickZoom(table) {
	    table[0].addEventListener('click',
	  function (ev) {
	      var t = ev.target;

	      var elemThis = $(t).closest('th,td');
	      var data = elemThis.data("agile_reportzoom");
	      if (!data)
	          return;

	      var params = getUrlParams();
	      for (var i = 0; i < data.replaces.length; i++) {
	          var rep = data.replaces[i];
	          params[rep.name] = rep.value;
	      }

	      if (data.bPivotByWeek)
	          params["pivotBy"] = PIVOT_BY.day;
	      else if (data.bPivotByYear || data.bPivotByMonth)
	          params["pivotBy"] = PIVOT_BY.month;
	      else
	          params["tab"] = 0;

	      if (data.bRemoveSimpleDateFilter)
	          params["sinceSimple"] = FILTER_DATE_ADVANCED;

	      if (ev.ctrlKey)
	          window.open(buildUrlFromParams("report.html", params, true), '_blank');
	      else
	          window.location.href = buildUrlFromParams("report.html", params);
	  }, false);
	}

	function addClickZoom(tdElem, urlParams, replaces, bRemoveSimpleDateFilter, title) {
		title = title || "";
		if (title != "")
		    tdElem.prop("title", title);

		if (bPivotByDate)
		    return; //REVIEW todo

	    //note: would be better to use anchors but I couldnt get them to be clickable in the whole cell so I went back
	    //to using a click handler on the cell	
		tdElem.css("cursor", "-webkit-zoom-in");
		tdElem.addClass("agile_hoverZoom");
        //offload creating zoom url to the moment the cell is clicked. that way we get the correct iTab and possible url modifications from elsewhere
		var data = {
		    replaces: replaces,
		    bPivotByWeek: bPivotByWeek,
		    bPivotByMonth: bPivotByMonth,
		    bPivotByYear: bPivotByYear,
		    bRemoveSimpleDateFilter: bRemoveSimpleDateFilter
		};
		tdElem.data("agile_reportzoom", data);
	}

	handleClickZoom(elemTableUser);
	handleClickZoom(elemTableBoard);
	var iCol = 0;
	var val = null;
	var tdElem = null;
	var strHeader = null;

	//HEADERS
	for (; iCol < tables.header.length; iCol++) {
		val = tables.header[iCol];
		var tdUser = $(strTh).text(val).attr("title", tables.tips[iCol]);
		var tdBoard = $(strTh).text(val).attr("title", tables.tips[iCol]);
		if (!bPivotByDate) {
		    replaces = [{ name: pivotStart, value: val }, { name: pivotEnd, value: val }];
		    if (val.length > 0) {
		        addClickZoom(tdUser, urlParams, replaces, true);
		        addClickZoom(tdBoard, urlParams, replaces, true);
		    }
		}
		if (iCol == 0) {
			tdUser.text("User");
			tdBoard.text("Board");
		}
		trUser.append(tdUser);
		trBoard.append(tdBoard);
	}
	elemTableUser.append(trUser);
	elemTableBoard.append(trBoard);

	
	var bLastRow = false;
	//BY USER
	var iRow = 0;
	for (; iRow < tables.byUser.length; iRow++) {
		trUser = $("<tr>");
		var valUser = tables.byUser[iRow][0];
		var tdUserCol = $(strTd).text(valUser).addClass("agile_pivotFirstCol");
		trUser.append(tdUserCol);

		bLastRow = (iRow == tables.byUser.length - 1);

		if (!bLastRow) {
		    replaces = [{ name: "user", value: valUser }];
		    addClickZoom(tdUserCol, urlParams, replaces, false);
		}
		else {
		    tdUserCol.css("font-weight", "bold");
		    tdUserCol.css("text-align", "right");
		}

		for (iCol = 1; iCol < tables.header.length; iCol++) {
			strHeader = tables.header[iCol];
			val = parseFixedFloat(tables.byUser[iRow][iCol]) || 0;
			tdElem = $(strTd).text(val).addClass("agile_pivot_value");
			if (val == 0)
			    tdElem.addClass("agile_pivotCell_Zero");
			trUser.append(tdElem);
			replaces = [{ name: pivotStart, value: strHeader }, { name: pivotEnd, value: strHeader }];
			if (bLastRow) {
			    //last row
			    tdElem.data("agile_total_row", "true");
			    tdElem.css("font-weight", "bold");
			}
			else {
			    replaces.push({ name: "user", value: valUser });
			}
			addClickZoom(tdElem, urlParams, replaces, true, strHeader + "    " + valUser);
			if (bPivotByWeek)
			    tdElem.data("agile_week", strHeader);

		}
		elemTableUser.append(trUser);
	}

	//BY BOARD
	for (iRow=0; iRow < tables.byBoard.length; iRow++) {
		trBoard = $("<tr>");
		var nameBoard = tables.byBoard[iRow][0].name || ""; //total rows dont have names
		if (!bNoTruncate)
		    nameBoard = strTruncate(nameBoard);
		var tdBoardCol = $(strTd).text(nameBoard).addClass("agile_pivotFirstCol");
		trBoard.append(tdBoardCol);
		var valIdBoard = tables.byBoard[iRow][0].idBoard;
		
		bLastRow = (iRow == tables.byBoard.length - 1);

		if (!bLastRow) {
		    replaces = [{ name: "idBoard", value: valIdBoard }];
		    addClickZoom(tdBoardCol, urlParams, replaces, false);
		}
		else {
		    tdBoardCol.css("font-weight", "bold");
		    tdBoardCol.css("text-align", "right");
		}

		for (iCol = 1; iCol < tables.header.length; iCol++) {
			strHeader = tables.header[iCol];
			val = parseFixedFloat(tables.byBoard[iRow][iCol]) || 0;
			tdElem = $(strTd).text(val).addClass("agile_pivot_value");
			if (val == 0)
			    tdElem.addClass("agile_pivotCell_Zero");
			trBoard.append(tdElem);
			replaces = [{ name: pivotStart, value: strHeader }, { name: pivotEnd, value: strHeader }];
			var titleCur = strHeader + "    " + nameBoard;

			if (bLastRow) {
			    //last row
			    tdElem.data("agile_total_row", "true");
			    tdElem.css("font-weight", "bold");
			}
			else {
			    replaces.push({ name: "idBoard", value: valIdBoard });
			}
			addClickZoom(tdElem, urlParams, replaces, true, titleCur);
			if (bPivotByWeek)
			    tdElem.data("agile_week", strHeader); //used later to detect current week column
		}
		elemTableBoard.append(trBoard);
	}

	elemByUser.empty();
	elemByBoard.empty();
	elemByUser.append(elemTableUser);
	elemByBoard.append(elemTableBoard);
	configAllPivotFormats();
}

function configAllPivotFormats() {
    if (g_bBuildSqlMode)
        return;
    configPivotFormat($("#tabs-1 .agile_format_container"), g_dataFormatUser, $(".agile_report_container_byUser"), ITAB_BYUSER);
    configPivotFormat($("#tabs-2 .agile_format_container"), g_dataFormatBoard, $(".agile_report_container_byBoard"), ITAB_BYBOARD);
}

/* calculateTables
 *
 * returns { header, tips, byUser, byBoard}, last row of byUser contains column totals
 **/
function calculateTables(rows, pivotBy) {
    var header = [""];
    var users = {};
    var boards = {};
    var i = 0;
    var iColumn = 0;
    var pivotLast = "";
    var tips= [""]; //tip for each header element
    var totalsPerPivot = [""]; //appended at the end of the user results
    var bPivotByMonth = (pivotBy == PIVOT_BY.month);
    var bPivotByWeek = (pivotBy == PIVOT_BY.week);
    var bPivotByDate = (pivotBy == PIVOT_BY.day);
    var bPivotByYear = (pivotBy == PIVOT_BY.year);

    for (; i < rows.length; i++) {
        var row = rows[i];
        if (row.spent == 0)
            continue;
        var pivotCur = row.week;
        var dateStart = new Date(row.date * 1000);

        if (bPivotByMonth) {
            pivotCur = row.month;
        }
        else if (bPivotByDate) {
            pivotCur = dateStart.toLocaleDateString();
        }
        else if (bPivotByYear)
            pivotCur = ""+dateStart.getFullYear();

        if (pivotCur != pivotLast) {
            iColumn++;
            header[iColumn] = pivotCur; //note column zero is skipped, start at 1
            pivotLast = pivotCur;
            if (bPivotByWeek) {
                dateStart.setDate(dateStart.getDate() - DowMapper.posWeekFromDow(dateStart.getDay()));
                var title = dateStart.toLocaleDateString();
                dateStart.setDate(dateStart.getDate() + 6);
                title = title + " - " + dateStart.toLocaleDateString();
                tips[iColumn] = title;
            }
            else if (bPivotByDate) {
                tips[iColumn] = getWeekdayName(dateStart.getDay()) + " " + getCurrentWeekNum(dateStart);
            }
            else if (bPivotByMonth) {
                var dateMonthStart = new Date(dateStart.getTime());
                var dateMonthEnd = new Date(dateStart.getFullYear(), dateStart.getMonth() + 1, 0);
                dateMonthStart.setDate(1);
                tips[iColumn] = getCurrentWeekNum(dateMonthStart) + " - " + getCurrentWeekNum(dateMonthEnd);
            }
            else if (bPivotByYear) {
                tips[iColumn] = "" + dateStart.getFullYear();
            }
        }
        var userRow = users[row.user];
        var bWasEmpty= (userRow === undefined);
        if (bWasEmpty)
            userRow = [row.user];
        var sumUser = userRow[iColumn] || 0;
        userRow[iColumn] = sumUser + row.spent;
        if (bWasEmpty)
            users[row.user] = userRow;

        totalsPerPivot[iColumn] = (totalsPerPivot[iColumn] || 0) + row.spent;

		var boardRow = boards[row.nameBoard];
		bWasEmpty = (boardRow === undefined);
		if (bWasEmpty)
			boardRow = [{ name: row.nameBoard, idBoard: row.idBoardH }];
		var sumBoard = boardRow[iColumn] || 0;
		boardRow[iColumn] = sumBoard + row.spent;
		if (bWasEmpty)
			boards[row.nameBoard] = boardRow;
	}


	function doSortUser(a, b) {
		return (a[0].toLowerCase().localeCompare(b[0].toLowerCase()));
	}

	function doSortBoard(a, b) {
		return (a[0].name.toLowerCase().localeCompare(b[0].name.toLowerCase()));
	}

	var rgUserRows = [];
	var rgBoardRows = [];
	for (i in users) 
		rgUserRows.push(users[i]);
	rgUserRows.sort(doSortUser);

	for (i in boards)
		rgBoardRows.push(boards[i]);
	rgBoardRows.sort(doSortBoard);
	rgUserRows.push(totalsPerPivot);
	rgBoardRows.push(totalsPerPivot);
	return { header: header, tips:tips, byUser: rgUserRows, byBoard: rgBoardRows };
}


function groupRows(rowsOrig, propertyGroup, propertySort) {

    var ret = [];

    //group
	if (propertyGroup.length > 0) {
		var i = 0;
		var map = {};
		var cMax = rowsOrig.length;
		var pGroups = propertyGroup.split("-");
		var propDateString = "dateString"; //review zig: ugly to do it here, but elsewhere requires another pass to rowsOrig
		for (; i < cMax; i++) {
		    var row = rowsOrig[i];

		    if (row[propDateString] === undefined && row.date !== undefined) {
		        var dateRow = new Date(row.date * 1000); //db is in seconds
		        row[propDateString] = makeDateOnlyString(dateRow);
		    }

			var key = "";
			var iProp = 0;

			for (; iProp < pGroups.length; iProp++)
				key = key + "/" + row[pGroups[iProp]];
			var group = map[key];
			if (group === undefined)
				group = cloneObject(row);
			else {
			    //rowid -1 when its just a card row (from the query UNION)
			    if (group.rowid == -1 && row.rowid != -1) {
			        var sSave = group.spent;
			        var eSave = group.est;
			        var eFirstSave = group.estFirst;
			        var rowidSave = group.rowid;
			        group = cloneObject(row); //re-clone so rows with s/e always take precedence over card-only rows.
			        group.spent = sSave;
			        group.est = eSave;
			        group.estFirst = eFirstSave;
			        group.rowid = rowidSave;
			    }
				group.spent += row.spent;
				group.est += row.est;
				group.estFirst += row.estFirst;
			    
				if (row.rowid !== undefined && row.rowid!= -1 && (group.rowid === undefined || row.rowid > group.rowid)) {
				    group.rowid = row.rowid; //maintanin rowid so that a "mark all read" on a grouped report will still find the largest rowid
				}
			}
			map[key] = group;
		}


		for (i in map) {
			ret.push(map[i]);
		}
	} else {
		ret = cloneObject(rowsOrig); //so sorting doesnt mess with rowsOrig
	}

    //sort
    //note: propDateString might not be in rows at this point (is here only if there was grouping)
	if (ret.length > 0 && propertySort.length > 0 && propertySort != "date") {
		var bString = typeof(ret[0][propertySort])=="string";
		var bRemain = (propertySort=="remain");
		ret.sort(function doSort(a, b) {
			if (bString)
				return (a[propertySort].localeCompare(b[propertySort]));
			var va = null;
			var vb = null;

			if (bRemain) {
				va = a.est - a.spent;
				vb = b.est - b.spent;
			} else {
				va = a[propertySort];
				vb = b[propertySort];
			}
			return (vb - va);
		});
	}
	return ret;
}

function getHtmlDrillDownTooltip(rows, bNoTruncate, groupBy, orderBy, eType, archived, deleted, bShowMonth) {
	var bOrderR = (orderBy == "remain");
	var header = [];
	var strAppendHeaders = (groupBy == "" ? "" : g_postFixHeaderLast);
	var bShowKeyword = g_bShowKeywordFilter;
	if (bShowKeyword)
	    header.push({ name: "Keyword" + strAppendHeaders });
	header.push({ name: "Date" + strAppendHeaders });
	header.push({ name: "Week" + strAppendHeaders });
	var bGroupByCardOrNone = (groupBy == "" || groupBy.toLowerCase().indexOf("card") >= 0);
	var bShowArchived = (g_bEnableTrelloSync && bGroupByCardOrNone && archived != "1" && archived != "0");
	var bShowDeleted = (g_bEnableTrelloSync && bGroupByCardOrNone && deleted != "1" && deleted != "0");
	if (bShowMonth)
	    header.push({ name: "Month" + strAppendHeaders});
	var bShowUser=(groupBy=="" || groupBy.toLowerCase().indexOf("user")>=0);
	if (bShowUser)
		header.push({ name: "User" });
	
	var bShowBoard=(groupBy=="" || groupBy.indexOf("idBoardH")>=0 || groupBy.indexOf("idCardH")>=0);
	if (bShowBoard)
		header.push({ name: "Board" });

	var bShowCard = (groupBy == "" || groupBy.indexOf("idCardH") >= 0);

	var bShowList = (g_bEnableTrelloSync && (groupBy == "" || groupBy.indexOf("nameList") >= 0 || bShowCard));
	if (bShowList)
	    header.push({ name: "List" });
	if (bShowCard)
	    header.push({ name: "Card" });


	header.push({ name: "S" });
	header.push({ name: "E 1ˢᵗ" });
	header.push({ name: "E" });

	bShowRemain = (bOrderR || groupBy != "");
	if (bShowRemain)
		header.push({ name: "R" });

	var bShowComment = (groupBy == "");
	if (bShowComment)
		header.push({ name: "Note", bExtend: true });
	
	var bShowEtype = (groupBy=="");

	if (bShowEtype)
	    header.push({ name: COLUMNNAME_ETYPE });

	if (bShowArchived)
	    header.push({ name: "Archived" });

	if (bShowDeleted)
	    header.push({ name: "Deleted" });

	var dateNowCache = new Date();
	function callbackRowData(row) {
	    if (row.rowid && row.rowid > g_rowidLastSyncRemember) //review zig: hacky way so we dont loop the array twice. would be nice if this was outside of view
	        g_rowidLastSyncRemember = row.rowid;
	    var rgRet = [];
	    var dateString = row["dateString"];
	    if (dateString === undefined) {
	        dateString = makeDateOnlyString(new Date(row.date * 1000)); //db is in seconds
	    }
	    if (bShowKeyword)
	        rgRet.push({ name: row.keyword, bNoTruncate: true });
	    rgRet.push({ name: dateString, bNoTruncate: true });
	    rgRet.push({ name: row.week ? row.week : getCurrentWeekNum(new Date(row.date * 1000)), bNoTruncate: true });
		if (bShowMonth)
		    rgRet.push({ name: row.month ? row.month : getCurrentWeekNum(new Date(row.date * 1000)), bNoTruncate: true });
		if (bShowUser)
			rgRet.push({ name: row.user, bNoTruncate: bNoTruncate });

		if (bShowBoard) {
			var urlBoard = "https://trello.com/b/" + row.idBoardH;
			rgRet.push({ name: "<A title='Go to Trello board' target='_blank' href='" + urlBoard + "'>" + (bNoTruncate?row.nameBoard:strTruncate(row.nameBoard)) + "</A>", bNoTruncate: true });
		}

		if (bShowList) {
		    var strListUse = row.nameList;
		    if (!bNoTruncate)
		        strListUse = strTruncate(strListUse, g_cchTruncateShort);
		    rgRet.push({ name: strListUse, bNoTruncate: true });
		}
		if (bShowCard) {
			var urlCard = null;
			if (row.idCardH.indexOf("https://") == 0)
				urlCard = row.idCardH; //old-style card URLs. Could be on old historical data from a previous Spent version
			else
				urlCard = "https://trello.com/c/" + row.idCardH;

			rgRet.push({ name: "<A title='Go to Trello card' target='_blank' href='" + urlCard + "'>" + (bNoTruncate?row.nameCard:strTruncate(row.nameCard)) + "</A>", bNoTruncate: true });
		}
		var sPush = parseFixedFloat(row.spent);
		var estPush = parseFixedFloat(row.est);
		rgRet.push({ type: "S", name: sPush, bNoTruncate: true });
		rgRet.push({ type: "EFirst", name: parseFixedFloat(row.estFirst), bNoTruncate: true }); //not type "E". that is used when showing sum of row selections
		rgRet.push({ type: "E", name: estPush, bNoTruncate: true });
		if (bShowRemain) {
			var remainCalc = parseFixedFloat(row.est - row.spent);
			if (bOrderR && remainCalc == 0)
				return [];
			rgRet.push({ type: "R", name: remainCalc, bNoTruncate: true }); //type "R" just so it generates the transparent zero
		}
		if (bShowComment)
			rgRet.push({ name: row.comment, bNoTruncate: bNoTruncate });

		if (bShowEtype)
		    rgRet.push({ name: nameFromEType(row.eType), bNoTruncate: true });

		if (bShowArchived)
		    rgRet.push({ name: row.bArchivedCB > 0 ? "Yes" : "No", bNoTruncate: true });

		if (bShowDeleted)
		    rgRet.push({ name: row.bDeleted ? "Yes" : "No", bNoTruncate: true });

		if (!bShowComment) {
			var title="Last: ";
			title += row.user;
			title += " - " + row.nameBoard;
			title += " - " + row.nameList;
			title += " - " + row.nameCard;
			title += " - " + row.comment;
			if (row.rowid == -1)
			    title += "\n(no s/e)";
			rgRet.title = title;
		} else {
		    rgRet.title = "(" + sPush + " / " + estPush + ") " + row.comment;
		}
		if (row.date) {
		    var delta = getDeltaDates(dateNowCache, new Date(row.date * 1000)); //db is in seconds
		    var postFix = " days ago";
		    if (delta == 1)
		        postFix = " day ago";
		    else if (delta == 0) {
		        delta = "";
		        postFix = "today";
		    }

		    rgRet.title = rgRet.title + "\n" + delta + postFix;
		}
		return rgRet;
	}

	return getHtmlBurndownTooltipFromRows(true, rows, false, header, callbackRowData, true, "");
}

function getSQLReport(sql, values, callback) {
	getSQLReportShared(sql, values, callback, function onError(status) {
		showError(status);
	});
}