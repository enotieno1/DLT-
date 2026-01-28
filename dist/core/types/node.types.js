"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageType = exports.NodeStatus = exports.NodeRole = void 0;
var NodeRole;
(function (NodeRole) {
    NodeRole["AUTHORITY"] = "authority";
    NodeRole["VALIDATOR"] = "validator";
    NodeRole["PEER"] = "peer";
})(NodeRole || (exports.NodeRole = NodeRole = {}));
var NodeStatus;
(function (NodeStatus) {
    NodeStatus["ACTIVE"] = "active";
    NodeStatus["INACTIVE"] = "inactive";
    NodeStatus["BANNED"] = "banned";
    NodeStatus["PENDING"] = "pending";
})(NodeStatus || (exports.NodeStatus = NodeStatus = {}));
var MessageType;
(function (MessageType) {
    MessageType["TRANSACTION"] = "transaction";
    MessageType["BLOCK"] = "block";
    MessageType["PEER_REQUEST"] = "peer_request";
    MessageType["PEER_RESPONSE"] = "peer_response";
    MessageType["HEARTBEAT"] = "heartbeat";
    MessageType["VOTE"] = "vote";
    MessageType["CONSENSUS"] = "consensus";
    MessageType["SYNC_REQUEST"] = "sync_request";
    MessageType["SYNC_RESPONSE"] = "sync_response";
})(MessageType || (exports.MessageType = MessageType = {}));
//# sourceMappingURL=node.types.js.map