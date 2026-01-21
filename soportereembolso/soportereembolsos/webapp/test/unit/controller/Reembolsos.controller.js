/*global QUnit*/

sap.ui.define([
	"co/com/conconcreto/soportereembolsos/controller/Reembolsos.controller"
], function (Controller) {
	"use strict";

	QUnit.module("Reembolsos Controller");

	QUnit.test("I should test the Reembolsos controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
