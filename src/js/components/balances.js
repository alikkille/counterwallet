ko.validation.rules['isValidAddressDescription'] = {
    validator: function (val, self) {
      return val.length <= 70; //arbitrary
    },
    message: 'Address description is more than 70 characters long.'
};
ko.validation.registerExtenders();

function CreateNewAddressModalViewModel() {
  var self = this;
  self.shown = ko.observable(false);
  self.description = ko.observable('').extend({
    required: true,
    isValidAddressDescription: self,
  });
  
  self.validationModel = ko.validatedObservable({
    description: self.description
  });

  self.resetForm = function() {
    self.description('');
    self.validationModel.errors.showAllMessages(false);
  }
  
  self.submitForm = function() {
    if (!self.validationModel.isValid()) {
      self.validationModel.errors.showAllMessages();
      return false;
    }    
    //data entry is valid...submit to trigger doAction()
    $('#createNewAddressModal form').submit();
  }

  self.doAction = function() {
    //generate new priv key and address via electrum
    var r = electrum_extend_chain(electrum_get_pubkey(WALLET.ELECTRUM_PRIV_KEY),
      WALLET.ELECTRUM_PRIV_KEY, WALLET.addresses().length /*-1 +1 = 0*/, false, true);
    //r = [addr.toString(), sec.toString(), newPub, newPriv]
    
    //set the description of this address
    $.jqlog.log("NEW address created: " + r[0]);
    WALLET.addKey(new Bitcoin.ECKey(r[1]), self.description());
    
    //update PREFS and push
    PREFERENCES['num_addresses_used'] += 1;
    PREFERENCES['address_aliases'][r[0]] = self.description();
    multiAPI("store_preferences", [WALLET.identifier(), PREFERENCES], function(data, endpoint) {
      self.shown(false);
      //reload page to reflect the addition
      $('#content').load("xcp/pages/balances.html");
      //^ don't use loadURL here as it won't do a full reload and re-render the new widget
    });
  }
  
  self.show = function(resetForm) {
    if(typeof(resetForm)==='undefined') resetForm = true;
    if(resetForm) self.resetForm();
    self.shown(true);
  }  

  self.hide = function() {
    self.shown(false);
  }  
}



ko.validation.rules['isValidSendAmountForBalance'] = {
    validator: function (val, self) {
      if((self.divisible() ? self.balance() / UNIT : self.balance()) - parseFloat(val) < 0) {
        return false;
      }
      return true;
    },
    message: 'Entered amount exceeds your current balance.'
};
ko.validation.registerExtenders();

function SendModalViewModel() {
  var self = this;
  self.shown = ko.observable(false);
  self.address = ko.observable(null);
  self.asset = ko.observable();
  self.balance = ko.observable(null);
  self.divisible = ko.observable();
  
  self.destAddress = ko.observable().extend({
    required: true,
    isValidBitcoinAddress: self,
    isNotSameBitcoinAddress: self
  });
  self.quantity = ko.observable().extend({
    required: true,
    pattern: {
      message: 'Must be a valid number',
      params: '^[0-9]*\.?[0-9]{0,8}$' //not perfect ... additional checking required
    },
    isValidQtyForDivisibility: self,
    isValidSendAmountForBalance: self
  });
  
  self.normalizedBalance = ko.computed(function() {
    if(self.address() === null || self.balance() === null) return null;
    return normalizeAmount(self.balance(), self.divisible());
  }, self);
  
  self.normalizedBalRemaining = ko.computed(function() {
    if(!isNumber(self.quantity())) return null;
    var curBalance = normalizeAmount(self.balance(), self.divisible());
    var balRemaining = Decimal.round(new Decimal(curBalance).sub(parseFloat(self.quantity()))).toFloat();
    if(balRemaining < 0) return null;
    return balRemaining;
  }, self);
  
  self.validationModel = ko.validatedObservable({
    destAddress: self.destAddress,
    quantity: self.quantity
  });  
  
  self.resetForm = function() {
    self.destAddress('');
    self.quantity(null);
    self.validationModel.errors.showAllMessages(false);
  }
  
  self.submitForm = function() {
    if (!self.validationModel.isValid()) {
      self.validationModel.errors.showAllMessages();
      return false;
    }    
    //data entry is valid...submit to the server
    $('#sendModal form').submit();
  }

  self.doAction = function() {
    var quantity = parseFloat(self.quantity());
    var rawQuantity = self.divisible() ? Math.round(quantity * UNIT) : parseInt(quantity);

    multiAPIConsensus("create_send",
      {source: self.address(), destination: self.destAddress(), quantity: rawQuantity, asset: self.asset(),
       multisig: WALLET.getAddressObj(self.address()).PUBKEY},
      function(unsignedTXHex, numTotalEndpoints, numConsensusEndpoints) {
        WALLET.signAndBroadcastTx(self.address(), unsignedTXHex);
        bootbox.alert("Your send seemed to be success. It will take effect as soon as the network has processed it.");
      }
    );
    
    self.shown(false);
  }
  
  self.show = function(fromAddress, asset, balance, isDivisible, resetForm) {
    if(asset == 'BTC' && balance != null) {
      return bootbox.alert("Cannot send BTC as we cannot currently get in touch with blockchain.info to get your balance");
    }
    assert(balance, "Balance is null or undefined?");
    
    if(typeof(resetForm)==='undefined') resetForm = true;
    if(resetForm) self.resetForm();
    self.address(fromAddress);
    self.asset(asset);
    self.balance(balance);
    self.divisible(isDivisible);
    self.shown(true);
  }  

  self.hide = function() {
    self.shown(false);
  }  
}


ko.validation.rules['isValidPrivateKey'] = {
    validator: function (val, self) {
      var eckey = new Bitcoin.ECKey(self.privateKey());
      return eckey.priv !== null && eckey.compressed !== null;
    },
    message: 'Not a valid private key.'
};
ko.validation.rules['addressHasEnoughUnspentTxouts'] = {
  async: true,
  message: 'The address for the private key specified does not have enough confirmed unspent txouts to sweep everything specified.',
  validator: function (val, self, callback) {
    if(!self.addressForPrivateKey()) return true; //isValidPrivateKey will cover this
    //Ensure that the source address has enough unspent txouts to send it
    WALLET.getUnspentBTCOutputs(self.addressForPrivateKey(), function(data) {
      var num_good_txouts = 0;
      for(var i = 0; i < data.length; i++) {
        if(data[i]['value'] >= .0004 * UNIT && data[i]['confirmations'] >= 1) {
          num_good_txouts += 1;     
        }
      }
      return callback(num_good_txouts >= self.selectedAssetsToSweep());
    })
    
  }
};
ko.validation.registerExtenders();

var AddressInDropdownItemModel = function(address, label) {
  this.ADDRESS = address;
  this.LABEL = label;
  this.SELECT_LABEL = label ? ("<b>" + label + "</b><br/>" + address) : (address);
};
var SweepAssetInDropdownItemModel = function(asset, balance) {
  this.ASSET = asset;
  this.BALANCE = balance; //normalized
  this.SELECT_LABEL = asset + " (bal: " + balance + ")";
};

function SweepModalViewModel() {
  var self = this;
  self.shown = ko.observable(false);
  self.privateKey = ko.observable().extend({
    required: true,
    isValidPrivateKey: self,
    addressHasEnoughUnspentTxouts: self
  });
  self.availableAssetsToSweep = ko.observableArray([]);
  //^ used for select box entries (composed dynamically on privateKey update)
  self.selectedAssetsToSweep = ko.observableArray([]).extend({
    required: true,
  });
  self.destAddress = ko.observable().extend({
    required: true,
    isValidBitcoinAddress: self
  });
  
  self.availableAddresses = ko.observableArray([]);
  
  self.addressForPrivateKey = ko.computed(function() {
    if(!self.fields.privateKey.value.isValid()) return null;
    //Get the address for this privatekey
    var eckey = new Bitcoin.ECKey(self.privateKey());
    asset(eckey.priv !== null && eckey.compressed !== null, "Private key not valid!"); //should have been checked already
    return eckey.getBitcoinAddress(USE_TESTNET ? address_types['testnet'] : address_types['prod']).toString();
  }, self);
  
  self.validationModel = ko.validatedObservable({
    privateKey: self.privateKey,
    selectedAssetsToSweep: self.selectedAssetsToSweep,
    destAddress: self.destAddress
  });  
  
  self.resetForm = function() {
    self.privateKey();
    self.selectedAssetsToSweep([]);
    self.destAddress();
    
    //populate the list of addresseses again
    self.availableAddresses([]);
    var addresses = WALLET.getAddressesList(true);
    for(var i = 0; i < addresses.length; i++) {
        self.availableAddresses.push(new AddressInDropdownItemModel(addresses[i][0], addresses[i][1]));
    }        
    
    self.validationModel.errors.showAllMessages(false);
  }
  
  self.submitForm = function() {
    if(self.name.isValidating()) {
      setTimeout(function() { //wait a bit and call again
        self.submitForm();
      }, 50);
      return;
    }

    if (!self.validationModel.isValid()) {
      self.validationModel.errors.showAllMessages();
      return false;
    }

    //data entry is valid...submit to trigger doAction()
    $('#sweepModal form').submit();
  }
  
  self._sweepCompleteDialog(sendsComplete) {
    var assetDisplayList = [];
    for(var i = 0; i < sendsComplete.length; i++) {
      if(sendsComplete[i]['result']) {
        assetDisplayList.push("<li><b>" + sendsComplete[i]['asset'] + ":</b> Sent "
          + sendsComplete[i]['normalized_amount'] + " from " + sendsComplete[i]['from']
          + " to " + sendsComplete[i]['to'] + "</li>");  
      } else {
        assetDisplayList.push("<li><b>" + sendsComplete[i]['asset'] + "</b>: Funds not sent due to failure.</li>");  
      }
    }
    bootbox.alert("The sweep is complete Sweep results:<br/><br/><ul>" + assetDisplayList.join('') + "</ul>");    
  }

  self.doAction = function() {
    var quantity = parseFloat(self.quantity());
    var rawQuantity = self.divisible() ? Math.round(quantity * UNIT) : parseInt(quantity);
  
    var eckey = new Bitcoin.ECKey(self.privateKey());
    asset(eckey.priv !== null && eckey.compressed !== null, "Private key not valid!"); //should have been checked already
    var pubkey = Crypto.util.bytesToHex(eckey.getPub());
    var sendsComplete = [];
  
    for(var i = 0; i < self.selectedAssetsToSweep().length; i++) {
      $.jqlog.log("Sweeping from: " + self.addressForPrivateKey() + " to " + self.destAddress() + " of RAW qty "
        + self.selectedAssetsToSweep()[i].BALANCE + " " + self.selectedAssetsToSweep()[i].ASSET);
       
      multiAPIConsensus("create_send", //can send both BTC and counterparty assets
        {source: self.addressForPrivateKey(), destination: self.destAddress(),
         quantity: self.selectedAssetsToSweep[i].BALANCE,
         asset: self.selectedAssetsToSweep()[i].ASSET, multisig: pubkey},
        function(unsignedTXHex, numTotalEndpoints, numConsensusEndpoints) {
          WALLET.signAndBroadcastTxRaw(eckey, unsignedTXHex);
          sendsComplete.push({'result': true, 'asset': self.self.selectedAssetsToSweep()[i],
             'from': self.addressForPrivateKey(), 'to': self.destAddress(),
             'normalized_amount': self.availableAssetsToSweepRaw[i]['normalized_amount']});
          if(sendsComplete.length == self.selectedAssetsToSweep().length) {
            return self._sweepCompleteDialog(sendsComplete);
          }
        }, function(unmatchingResultsList) { //onConsensusError
          sendsComplete.push({'result': false, 'asset': self.self.selectedAssetsToSweep()[i]});
          if(sendsComplete.length == self.selectedAssetsToSweep().length) {
            return self._sweepCompleteDialog(sendsComplete);
          }
        }, function(jqXHR, textStatus, errorThrown, endpoint) { //onSysError
          sendsComplete.push({'result': false, 'asset': self.self.selectedAssetsToSweep()[i]});
          if(sendsComplete.length == self.selectedAssetsToSweep().length) {
            return self._sweepCompleteDialog(sendsComplete);
          }
        }
      );
    }

    self.shown(false);
  }
  
  self.show = function(resetForm) {
    if(typeof(resetForm)==='undefined') resetForm = true;
    if(resetForm) self.resetForm();
    self.shown(true);
  }  

  self.hide = function() {
    self.shown(false);
  }
  
  self.addressForPrivateKey.subscribe(function(newValue) {
    //set up handler on changes in private key to generate a list of balances
    if(!newValue) return;

    //Get the balance of ALL assets at this address
    failoverAPI("get_normalized_balances", [newValue], function(data, endpoint) {
      for(var i=0; i < data.length; i++) {
        self.availableAssetsToSweep.push(new SweepAssetInDropdownItemModel(data['asset'], data['normalized_amount']));
      }
    });
  });  
}

function SignMessageModalViewModel() {
  var self = this;
  self.shown = ko.observable(false);
  self.address = ko.observable();
  self.message = ko.observable().extend({
    required: true,
  });
  
  self.validationModel = ko.validatedObservable({
    stringToSign: self.stringToSign
  });
  
  self.signedMessage = ko.computed(function() {
    if(!self.fields.message.value.isValid() || !self.fields.selectedAddress.value.isValid()) return null;
    var eckey = WALLET.getAddressObj(self.address()).KEY;
    return sign_message(eckey, self.message(), eckey.compressed,
      USE_TESTNET ? address_types['testnet'] : address_types['prod']);
  }, self);
    
  self.resetForm = function() {
    self.selectedAddress();
    self.message();
    self.validationModel.errors.showAllMessages(false);
  }
  
  self.show = function(address, resetForm) {
    if(typeof(resetForm)==='undefined') resetForm = true;
    if(resetForm) self.resetForm();
    self.address(address);
    self.shown(true);
  }  

  self.hide = function() {
    self.shown(false);
  }
}

function PrimeAddressModalViewModel() {
  var self = this;
  self.shown = ko.observable(false);
  self.address = ko.observable();
  self.numNewPrimedTxouts = ko.observable(10).extend({  //default to 10
    required: true,
    number: true,
    min: 3,
    max: 25
  });
  self.rawUnspentTXResponse = null;
  
  self.validationModel = ko.validatedObservable({
    numNewPrimedTxouts: self.numNewPrimedTxouts
  });
  
  self.dispNumUnspentTxouts = ko.computed(function() {
    return WALLET.getNumUnspentTxouts(address);
  }, self);
  
  self.resetForm = function() {
    self.numNewPrimedTxouts(10);
    self.validationModel.errors.showAllMessages(false);
  }
  
  self.submitForm = function() {
    if (!self.validationModel.isValid()) {
      self.validationModel.errors.showAllMessages();
      return false;
    }    
    //data entry is valid...submit to trigger doAction()
    $('#primeAddressModal form').submit();
  }
  
  self.show = function(address, resetForm) {
    if(typeof(resetForm)==='undefined') resetForm = true;
    if(resetForm) self.resetForm();
    self.address(address);
    
    //Get the most up to date # of primed txouts
    WALLET.getUnspentBTCOutputs(address, function(numUnspentTxouts, rawUnspentTXResponse) {
      WALLET.updateNumUnspentTxouts(address, numUnspentTxouts);
      self.rawUnspentTXResponse = rawUnspentTXResponse; //save for later (when creating the TX itself)
      self.shown(true);
    }, function(jqXHR, textStatus, errorThrown) {
      self.updateNumUnspentTxouts(address, null);
      bootbox.alert("Cannot fetch the number of unspent txouts from blockchain.info. Please try again later.");
    });
  }  

  self.hide = function() {
    self.shown(false);
  }
  
  self.doAction = function() {
    //construct a transaction
    TX.init(WALLET.getAddressObj(self.address()).KEY);
    assert(TX.getAddress() == self.address(), "Addresses don't match!");
    TX.parseInputs(JSON.stringify(self.rawUnspentTXResponse), TX.getAddress());
    
    for(var i=0; i < self.numNewPrimedTxouts.length; i++) {
      TX.addOutput(TX.getAddress(), MIN_PRIME_BALANCE / UNIT); //add a number of .0005 outputs to the txn  
    }
    var sendTx = TX.construct();
    var rawTxHex = Crypto.util.bytesToHex(sendTx.serialize());
    $.jqlog.log("RAW SIGNED TX: " + TX.toBBE(sendTx));
    $.jqlog.log("RAW SIGNED HEX: " + rawTxHex);
    //WALLET.sendTX(rawTxHex);
    //^ ENABLE LATER :)
  }
}


var CREATE_NEW_ADDRESS_MODAL = new CreateNewAddressModalViewModel();
var SEND_MODAL = new SendModalViewModel();
var SWEEP_MODAL = new SweepModalViewModel();
var SIGN_MESSAGE_MODAL = new SignMessageModalViewModel();
var PRIME_ADDRESS_MODAL = new PrimeAddressModalViewModel();

$(document).ready(function() {
  ko.applyBindingsWithValidation(CREATE_NEW_ADDRESS_MODAL, document.getElementById("createNewAddressModal"));
  ko.applyBindingsWithValidation(SEND_MODAL, document.getElementById("sendModal"));
  ko.applyBindingsWithValidation(SWEEP_MODAL, document.getElementById("sweepModal"));
  ko.applyBindingsWithValidation(SWEEP_MODAL, document.getElementById("signMessageModal"));
  ko.applyBindingsWithValidation(PRIME_ADDRESS_MODAL, document.getElementById("primeAddressModal"));
});

$('#createNewAddress').click(function() {
  if(WALLET.addresses.length >= MAX_ADDRESSES) { bootbox.alert("You already have the max number of addresses for a single wallet ("
    + MAX_ADDRESSES + "). Please create a new wallet for more."); return; }
  CREATE_NEW_ADDRESS_MODAL.show();
});

$('#sweepFunds').click(function() {
  SWEEP_MODAL.show();
});