//  _______         _  _         _       _____                          
// |__   __|       (_)| |       | |     |  __ \                        
//    | |__      __ _ | |_  ___ | |__   | |  | | _ __  ___   _ __   ___
//    | |\ \ /\ / /| || __|/ __|| '_ \  | |  | || '__|/ _ \ | '_ \ / __|
//    | | \ V  V / | || |_| (__ | | | | | |__| || |  | (_) || |_) |\__ \
//    |_|  \_/\_/  |_| \__|\___||_| |_| |_____/ |_|   \___/ | .__/ |___/
//                                                          | |                                
//                                                          |_|          


var client_id = null;
var client_secret = null;
var game_id = null;
var secret_key = null;


handlers.TwitchDrops = function(args, context) {
    const account = server.GetUserAccountInfo({"PlayFabId" : currentPlayerId});
    var response;
   
    if (account.UserInfo && account.UserInfo.TwitchInfo) {
        log.info("Twitch Info is set");
        response = twitchDrops(account.UserInfo.TwitchInfo.TwitchId);
    }
    else{
        log.info("No twitch account attached to user.");
        response = {
            TwitchDropsToClaim: false,
            response: null
        };
    }
    return { response };
};


function twitchDrops(twitchUserId){
    log.info("We have Called Twitchdrops.");
    var answer = getSetTitleInternalData();
    if(answer === true){
        var hasTwitchDropsToClaim = false;
        let response = clientCredentialsGrant(); //Get access token for twitch
        if(response !== null){
            let access_token = response.access_token;


            //Getting the items claimed on twitch for user
            response = GetDropsEntitlements(response.access_token, twitchUserId);
            if(response && response.data.length > 0){
                hasTwitchDropsToClaim = true;


                //Get Player Data for previous claimed and failed items
                var twitchRewardsData = GetStoredTwitchRewardData();


                //Return two arrays, items not claimed yet, and items that we have a record of claiming based on player data
                let data = FilterPlayfabItemAlreadyClaimed(response.data, twitchRewardsData);


                //Claiming the item for the player
                response = SetPlayfabItemsClaimed(data.itemsNotClaimed);


                //Updating the record of items claimed and failed
                if(response.itemsGranted.length > 0 || response.itemsFailed.length > 0){
                    recordOfTwitchRewards(response.itemsGranted, response.itemsFailed, twitchRewardsData);
                }


                //Adding both array to be patched as furfilled, Saved data and just granted to user
                var items = response.itemsGranted.concat(data.itemsAlreadyClaimed);
                //Updating records on twitch to fulfilled for items that have just been claimed
                var entitlement_ids = GetEntitlementIds(items);
                PatchDropsEntitlements(access_token, entitlement_ids);


            }
            else{ //If there is no response or no drops to claim we return a null
                response = null;
            }
        }
        return {
            TwitchDropsToClaim: hasTwitchDropsToClaim,
            response
        };
    }
    else{
        return {response: "Error getting stored Title Data: twitch_client_id, twitch_client_secret, twitch_game_id"};
    }
}


function getSetTitleInternalData() {
    var getTitleInternalDataRequest = {
        "Keys": ["twitch_client_id", "twitch_client_secret", "twitch_game_id", "playfab_secret_key"]
    };


    let getTitleInternalDataResult = server.GetTitleInternalData(getTitleInternalDataRequest);
    // var result = JSON.parse(getTitleInternalDataResult);


    // log.info(getTitleInternalDataResult);


    client_id = getTitleInternalDataResult.Data.twitch_client_id;
    client_secret = getTitleInternalDataResult.Data.twitch_client_secret;
    game_id = parseInt(getTitleInternalDataResult.Data.twitch_game_id);
    secret_key = getTitleInternalDataResult.Data.playfab_secret_key;


    if(client_id === undefined ||client_secret === undefined ||game_id === undefined){
        log.error("Error getting stored Title Data: twitch_client_id, twitch_client_secret, twitch_game_id");
        return false;
    }
    else{
        return true;
    }
}


// Recieveing the access token for twitch.
function clientCredentialsGrant(){
    log.info("Getting Access Token Twitch.");


    const grant_type = "client_credentials";


    const url = "https://id.twitch.tv/oauth2/token"+
        "?client_id=" + client_id +
        "&client_secret=" + client_secret +
        "&grant_type=" + grant_type;
   
    var headers = {
        "Content-Type": "application/x-www-form-urlencoded"
    };


    var body = null;


    var content = JSON.stringify(body);
    var httpMethod = "post";
    var contentType = "application/json";
   
    var response = http.request(url, httpMethod, content, contentType, headers);


    var responseBody = JSON.parse(response);


    if (responseBody.access_token != null) {
       
        log.info("Received Twitch OAuth Token");
        let access_token = responseBody.access_token


        return { access_token };
    }
    else {
        log.error("Error calling Twitch API", responseBody);
        return null;
    }
}


//Getting the drop rewards from twitch.
function GetDropsEntitlements(access_token, userId){
    log.info("Getting Twitch Drops Rewards.");
    const url = "https://api.twitch.tv/helix/entitlements/drops"+
        "?user_id=" + userId +
        "&game_id=" + game_id +
        "&fulfillment_status=" + "CLAIMED";
   
    var headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Bearer " + access_token,
        "Client-ID": client_id
    };


    var body = null;
    var content = JSON.stringify(body);
    var httpMethod = "get";
    var contentType = "application/json";
   
    var response = http.request(url, httpMethod, content, contentType, headers);
    var rewardItemsData = JSON.parse(response);


    if (rewardItemsData.data.length > 0) {
        log.info("Twitch Drops Rewards", rewardItemsData);
        var data = rewardItemsData.data;
        return { data };
    }
    else{
        log.error("No rewards are returned from Twitch", rewardItemsData);
        return null;
    }
}


//Preparing EntitlementIds for Patching Twitch Drop reward to filfilled.
function GetEntitlementIds(data){
    let entitlement_ids = [];
   
    for (let i = 0; i < data.length; i++) {
        entitlement_ids.push(data[i].twitchId);
    }
    return entitlement_ids;
}


//Comparing the response from Twitch drop reward agains the data stored, prevent items not being claimed twice
function FilterPlayfabItemAlreadyClaimed(data, twitchRewardsData){
    var itemsNotClaimed = [];
    var itemsAlreadyClaimed = [];


    for(let i = 0;i < data.length; i++) {
        //Prevent item form being granted twice
        if(twitchRewardsData.itemsSuccessMap.has(data[i].id)){//Item Already Claimed
            var item = twitchRewardsData.itemsSuccessMap.get(data[i].id);
            var itemData = {
                twitchId: data[i].id,
                item
            };
            itemsAlreadyClaimed.push(itemData);
        }
        else{//Item Needs to be claimed
            itemsNotClaimed.push(data[i]);
        }
    }
    log.info("FilterPlayfabItemAlreadyClaimed itemsAlreadyClaimed", itemsAlreadyClaimed);
    log.info("FilterPlayfabItemAlreadyClaimed itemsNotClaimed", itemsNotClaimed);
    return {itemsNotClaimed, itemsAlreadyClaimed};
}


//Granting items to Playfab account
function SetPlayfabItemsClaimed(data){
    log.info("Granting Items to playfab user.");


    var itemsGranted = [];
    var itemsFailed = [];
    var itemsGrantFailures = false;
   
    for(let i = 0; i < data.length; i++) {


        // Catalog V1
        // var item = GrantItemToUserV1(data[i].benefit_id);


        // Catalog V2
        var item = GrantItemToUserV2(data[i].benefit_id);


        // Catalog V1
        // if(item.Result === true){
        if(item != null){ //item successfully granted to player
            var itemData = {
                twitchId: data[i].id,
                playfabFriendlyId: data[i].benefit_id,
                item
            };
            itemsGranted.push(itemData);
        }
        else{ //item failed when granting to player
            itemsGrantFailures = true;
            var itemData = {
                twitchId: data[i].id,
                playfabFriendlyId: data[i].benefit_id,
                item
            };
            itemsFailed.push(itemData);
        }
    }
    return {
        itemsGranted,
        itemsGrantFailures,
        itemsFailed
    };
}


//Grant a Item to the user V1
function GrantItemToUserV1(item) {
    const userPlayFabId = server.GetUserAccountInfo({"PlayFabId" : currentPlayerId});
    var grantResult = server.GrantItemsToUser({
        PlayFabId: currentPlayerId,
        ItemIds: [item],
        CatalogVersion: "The Bornless",
        Annotation: "Item granted via Twitch reward"
    });


    // Log the result of the operation
    if (grantResult.ItemGrantResults) {
        log.info("Item granted attempt: " + JSON.stringify(grantResult.ItemGrantResults));
    } else {
        log.error("Failed to grant items");
    }


    return grantResult.ItemGrantResults[0];
}


function GrantItemToUserV2(itemId){
    const titleId = script.titleId;
    const entityToken = GetEntityToken();
    if(entityToken == null) return null;


    const playerEntity = GetPlayerEntity();
    if(playerEntity == null) return null;


    const url = 'https://'+titleId+'.playfabapi.com/Inventory/AddInventoryItems';
    const headers = {
        "Content-Type": "application/json",
        "X-EntityToken": entityToken
    }


    const body = {
        "Amount" : 1,
        "Entity": playerEntity,
        "Item": {
            "AlternateId": {
                "Value" : itemId,
                "Type" : "FriendlyId",
            },
            "StackId": "default"
        }
    }
    var content = JSON.stringify(body);
    var httpMethod = "post";
    var contentType = "application/json";


    var response = http.request(url, httpMethod, content, contentType, headers);


    const responseData = JSON.parse(response);


    if(responseData.code !== 200){
        log.error("Couldnt Grant Item to user: " + response);
        return null;
    }


    log.info("Granted Item to user: " + response);
    return response;
}


function GetEntityToken(){
    const titleId = script.titleId;


    const url = `https://${titleId}.playfabapi.com/Authentication/GetEntityToken`;
    const headers = {
        "Content-Type": "application/json",
        "X-SecretKey": secret_key
    };


    const response = http.request(url, "post", "", "application/json", headers);


    const tokenData = JSON.parse(response);


    if (tokenData.code != 200) {
        log.error("Failed to get EntityToken: " + tokenData.error);
    }


    return tokenData.data.EntityToken;
}


function GetPlayerEntity(){
    const account = server.GetUserAccountInfo({"PlayFabId": currentPlayerId});


    if (account && account.UserInfo && account.UserInfo.TitleInfo && account.UserInfo.TitleInfo.TitlePlayerAccount) {
        const playerEntity = {
            "Id": account.UserInfo.TitleInfo.TitlePlayerAccount.Id,
            "Type": "title_player_account"
        };


        log.info(playerEntity);
        return playerEntity;
    } else {
        log.error("Unable to retrieve player entity information.");
        return null;
    }
}


//Patching Twitch Drop rewards to filfilled.
function PatchDropsEntitlements(access_token, entitlement_ids){
    log.info("Patch Twitch Drops Rewards to FULFILLED.");


    const url = "https://api.twitch.tv/helix/entitlements/drops";
    const fulfillment_status = "FULFILLED";
   
    var headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Bearer " + access_token,
        "Client-ID": client_id
    };


    var body = {
        fulfillment_status: fulfillment_status,
        entitlement_ids
    };
    var content = JSON.stringify(body);
    // log.info(content);
    var httpMethod = "patch";
    var contentType = "application/json";
   
    var response = http.request(url, httpMethod, content, contentType, headers);


    log.info("Response from setting id to FULFILLED", response);
}


//Saving the claimed and failed items to the Player Data
function recordOfTwitchRewards(itemsGranted, itemsNotGranted, twitchRewardsData){
    if(itemsGranted.length > 0){
        for (let index = 0; index < itemsGranted.length; ++index) {
            var item = {
                twitchId: itemsGranted[index].twitchId,
                playfabItemId: itemsGranted[index].playfabFriendlyId
                // itemDetails: itemsGranted[index].item
            };
            twitchRewardsData.itemsSuccessMap.set(itemsGranted[index].twitchId, item);
            log.info(itemsGranted[index].twitchId +" Success: ",twitchRewardsData.itemsSuccessMap.get(itemsGranted[index].twitchId));


            if(twitchRewardsData.itemsFailedMap.has(itemsGranted[index].twitchId)){
                log.info("Item Previously Failed, Deleteing: " + itemsGranted[index].twitchId);
                twitchRewardsData.itemsFailedMap.delete(itemsGranted[index].twitchId);
            }
        }
    }


    if(itemsNotGranted.length > 0){
        for (let index = 0; index < itemsNotGranted.length; ++index) {
            if(twitchRewardsData.itemsFailedMap.has(itemsNotGranted[index].twitchId)){
                log.info("Failed item already exists: " + itemsNotGranted[index].twitchId);
                twitchRewardsData.itemsFailedMap.get(itemsNotGranted[index].twitchId).attempts++;
            }
            else{
                var item = {
                    twitchId: itemsNotGranted[index].twitchId,
                    playfabItemId: itemsNotGranted[index].playfabFriendlyId,
                    attempts: 1
                };
                twitchRewardsData.itemsFailedMap.set(itemsNotGranted[index].twitchId, item);
            }
            log.info(itemsNotGranted[index].twitchId +" Failed: ",twitchRewardsData.itemsFailedMap.get(itemsNotGranted[index].twitchId));
        }
    }


    log.info("Saving itemsSuccessMap:", Array.from(twitchRewardsData.itemsSuccessMap.entries()));
    log.info("Saving itemsFailedMap:", Array.from(twitchRewardsData.itemsFailedMap.entries()));


    const itemsSuccess = Object.fromEntries(twitchRewardsData.itemsSuccessMap);
    const itemsFailed = Object.fromEntries(twitchRewardsData.itemsFailedMap);


    var data = {
        itemsSuccess,
        itemsFailed
    };


    var updateDataRequest = {
        PlayFabId: currentPlayerId,
        Data: {
            "TwitchRewardsData": JSON.stringify(data)
        }
    };
   
    log.info("TwitchRewardsData updateDataRequest", updateDataRequest);


    var updateResult = server.UpdateUserData(updateDataRequest);


    log.info("TwitchRewardsData update result", updateResult);
}


// Loading the claimed and failed items from the Player Data
function GetStoredTwitchRewardData(){
    var getUserDataRequest = {
        PlayFabId: currentPlayerId
    };


    var playerDataResult = server.GetUserData(getUserDataRequest);
    // log.info("playerDataResult Returned", playerDataResult);


    if (playerDataResult.Data && playerDataResult.Data["TwitchRewardsData"]) {
        var obj = playerDataResult.Data["TwitchRewardsData"].Value;
        log.info("TwitchRewardsData Returned", obj);


        const parsedData = JSON.parse(obj);


        const itemsSuccessObject = parsedData.itemsSuccess;
        const itemsFailedObject = parsedData.itemsFailed;


        var itemsSuccessMap = new Map(Object.entries(itemsSuccessObject));
        var itemsFailedMap = new Map(Object.entries(itemsFailedObject));


        log.info("Recieveing itemsSuccessMap:", Array.from(itemsSuccessMap.entries()));
        log.info("Recieveing itemsFailedMap:", Array.from(itemsFailedMap.entries()));


        return {itemsSuccessMap, itemsFailedMap};
    } else {
        log.info("No previous TwitchRewardsData stored");
        var itemsSuccessMap = new Map();
        var itemsFailedMap = new Map();
        return {itemsSuccessMap, itemsFailedMap};
    }
}


//  _______         _  _         _       _____                            ______             _
// |__   __|       (_)| |       | |     |  __ \                          |  ____|           | |
//    | |__      __ _ | |_  ___ | |__   | |  | | _ __  ___   _ __   ___  | |__    _ __    __| |
//    | |\ \ /\ / /| || __|/ __|| '_ \  | |  | || '__|/ _ \ | '_ \ / __| |  __|  | '_ \  / _` |
//    | | \ V  V / | || |_| (__ | | | | | |__| || |  | (_) || |_) |\__ \ | |____ | | | || (_| |
//    |_|  \_/\_/  |_| \__|\___||_| |_| |_____/ |_|   \___/ | .__/ |___/ |______||_| |_| \__,_|
//                                                          | |                                
//                                                          |_|    

