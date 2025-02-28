const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const fs = require('fs');

// Import item system
const { createItemFromTemplate, ITEM_TEMPLATES } = require('./models/items');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get available avatars from the directory
const getAvailableAvatars = () => {
  const avatarDir = path.join(__dirname, 'public', 'images', 'avatars');

  // Create directory if it doesn't exist
  if (!fs.existsSync(avatarDir)) {
    fs.mkdirSync(avatarDir, { recursive: true });
    return [`https://robohash.org/default?size=64x64&set=set1`];
  }

  try {
    const files = fs.readdirSync(avatarDir);
    const avatarFiles = files.filter(file => 
      /\.(jpg|jpeg|png|gif)$/i.test(file)
    );

    // If no avatars found, return a default robohash
    if (avatarFiles.length === 0) {
      return [
        `https://robohash.org/1?size=64x64&set=set1`,
        `https://robohash.org/2?size=64x64&set=set1`,
        `https://robohash.org/3?size=64x64&set=set1`,
        `https://robohash.org/4?size=64x64&set=set1`,
        `https://robohash.org/5?size=64x64&set=set1`
      ];
    }

    return avatarFiles.map(file => `/images/avatars/${file}`);
  } catch (error) {
    console.error("Error reading avatar directory:", error);
    return [`https://robohash.org/default?size=64x64&set=set1`];
  }
};

// In-memory data storage
const players = {};
const avatars = getAvailableAvatars();

// Default position for items and players
const DEFAULT_LAT = 40.7128;
const DEFAULT_LNG = -74.0060;

// Create world items from templates with collection timers
// Initially empty, will be populated after first player joins for better positioning
let worldItems = [];

// Function to create initial items near a specific position
function createInitialItemsNearPosition(lat, lng) {
  // Only create if no items exist yet
  if (worldItems.length === 0) {
    worldItems = [
      createItemFromTemplate('health-potion', { 
        position: { lat: lat, lng: lng + 0.0002 },
        collectionTime: 2000 // 2 seconds to collect
      }),
      createItemFromTemplate('iron-sword', { 
        position: { lat: lat + 0.0002, lng: lng - 0.0001 },
        collectionTime: 5000 // 5 seconds to collect
      }),
      createItemFromTemplate('gold-coin', { 
        position: { lat: lat - 0.0001, lng: lng + 0.0001 },
        collectionTime: 1000 // 1 second to collect
      }),
      createItemFromTemplate('leather-armor', { 
        position: { lat: lat + 0.0001, lng: lng - 0.0002 },
        collectionTime: 3000 // 3 seconds to collect
      })
    ];
  }
  return worldItems;
}

// Function to spawn new items periodically
function spawnNewItems() {
  // Get average player position or default to NYC if no players
  let centerLat = 40.7128;
  let centerLng = -74.0060;

  // Use first player's position if available (for debugging)
  const playerIds = Object.keys(players);
  if (playerIds.length > 0) {
    const firstPlayer = players[playerIds[0]];
    if (firstPlayer && firstPlayer.position) {
      centerLat = firstPlayer.position.lat;
      centerLng = firstPlayer.position.lng;
    }
  }

  const radius = 0.0008; // roughly 80 meters - closer for debugging

  // Random position within radius
  const randomPosition = () => {
    const r = radius * Math.sqrt(Math.random());
    const theta = Math.random() * 2 * Math.PI;
    return {
      lat: centerLat + r * Math.cos(theta),
      lng: centerLng + r * Math.sin(theta)
    };
  };

  // Possible item types to spawn
  const itemTypes = ['health-potion', 'iron-sword', 'gold-coin', 'leather-armor'];
  const randomItemType = itemTypes[Math.floor(Math.random() * itemTypes.length)];

  // Collection times based on rarity
  const collectionTimes = {
    'health-potion': 2000,
    'iron-sword': 5000,
    'gold-coin': 1000,
    'leather-armor': 3000
  };

  // Create and add the new item
  const newItem = createItemFromTemplate(randomItemType, {
    position: randomPosition(),
    collectionTime: collectionTimes[randomItemType]
  });

  worldItems.push(newItem);

  // Broadcast the new item to all clients
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: "item_spawned",
        item: newItem
      }));
    }
  });

  // Schedule next spawn (random between 30-60 seconds)
  const nextSpawnTime = 30000 + Math.random() * 30000;
  setTimeout(spawnNewItems, nextSpawnTime);
}

// Start the item spawning cycle
setTimeout(spawnNewItems, 10000); // First spawn after 10 seconds

// Session tokens for security (mapping clientId -> playerId)
const clientSessions = new Map();

// Helper to validate that a client is authorized to modify a player
const isAuthorizedForPlayer = (clientId, targetPlayerId) => {
  return clientSessions.get(clientId) === targetPlayerId;
};

// WebSocket connection handling
wss.on("connection", (ws) => {
  console.log("New client connected!");
  const clientId = uuidv4(); // Unique ID for this connection
  const playerId = uuidv4(); // Unique ID for the player

  // Create session token for this client
  clientSessions.set(clientId, playerId);

  // Attach client ID to the WebSocket instance for later reference
  ws.clientId = clientId;

  // Create a new player
  players[playerId] = {
    id: playerId,
    name: `Player-${playerId.slice(0, 4)}`,
    position: { lat: 40.7128, lng: -74.0060 }, // Default position (NYC) until updated
    avatar: avatars[Math.floor(Math.random() * avatars.length)],
    hp: 100,
    level: 1,
    xp: 0,
    gold: 10,
    inventory: [],
    stats: {
      strength: 5,
      dexterity: 5,
      intelligence: 5,
      stamina: 5
    },
    lastMessage: ""
  };

  // Create initial items near the player's position
  const playerPos = players[playerId].position;
  createInitialItemsNearPosition(playerPos.lat, playerPos.lng);

  // Send initial data to the new player
  ws.send(JSON.stringify({
    type: "init",
    clientId: clientId,
    playerId: playerId,
    player: players[playerId],
    players: players,
    items: worldItems,
    availableAvatars: avatars
  }));

  // Broadcast new player to all other players
  wss.clients.forEach((client) => {
    if (client !== ws && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: "player_joined",
        player: players[playerId]
      }));
    }
  });

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`Received: ${data.type} from ${clientId} (Player: ${playerId})`);

      // Always check that the client is authorized for the player they're trying to modify
      // This is essential for security to prevent players from modifying other players' data
      const targetPlayerId = data.playerId || playerId;

      if (data.type !== "view_profile" && targetPlayerId !== playerId && !isAuthorizedForPlayer(clientId, targetPlayerId)) {
        console.error(`Unauthorized action attempted by ${clientId} on player ${targetPlayerId}`);
        return;
      }

      switch(data.type) {
        case "update_position":
          players[playerId].position = data.position;
          break;

        case "chat_message":
          players[playerId].lastMessage = data.message;
          break;

        case "pickup_item":
          console.log("Pickup item request received for item:", data.itemId);
          const itemIndex = worldItems.findIndex(item => item.itemId === data.itemId);
          if (itemIndex !== -1) {
            console.log("Item found in world items at index:", itemIndex);
            // Check if player is close enough to the item
            const itemPos = worldItems[itemIndex].position;
            const playerPos = players[playerId].position;

            // Calculate distance using Haversine formula (simplified for demo)
            const dist = Math.sqrt(
              Math.pow(itemPos.lat - playerPos.lat, 2) + 
              Math.pow(itemPos.lng - playerPos.lng, 2)
            );

            console.log("Distance to item:", dist);
            // Only allow pickup if player is close (adjust threshold as needed)
            if (dist < 0.001) { // roughly 100 meters
              const item = worldItems[itemIndex];

              // Start collection timer if not already collecting
              if (!item.beingCollected) {
                console.log("Starting collection for item:", item.name);
                item.beingCollected = true;
                item.collectorId = playerId;

                // Set collection time (default to 3 seconds if not specified)
                const collectionTime = item.collectionTime || 3000;

                // Notify player that collection has started
                ws.send(JSON.stringify({
                  type: "collection_started",
                  itemId: item.itemId,
                  collectionTime: collectionTime
                }));

                // After timer completes, add to inventory and remove from world
                setTimeout(() => {
                  // Make sure item still exists and player is still collecting
                  const currentItemIndex = worldItems.findIndex(i => i.itemId === item.itemId);
                  if (currentItemIndex !== -1 && worldItems[currentItemIndex].collectorId === playerId) {
                    console.log("Collection completed for item:", item.name);
                    // Add item rewards to player
                    if (item.type === 'collectible' && item.stats && item.stats.value) {
                      players[playerId].gold += item.stats.value;
                      console.log("Added gold to player:", item.stats.value);
                    } else {
                      players[playerId].inventory.push(worldItems[currentItemIndex]);
                      console.log("Added item to player inventory:", item.name);
                    }

                    // Remove item from world
                    worldItems.splice(currentItemIndex, 1);

                    // Notify player of successful collection with updated inventory
                    ws.send(JSON.stringify({
                      type: "collection_complete",
                      itemId: item.itemId,
                      playerGold: players[playerId].gold,
                      inventory: players[playerId].inventory
                    }));

                    // Update all clients
                    wss.clients.forEach((client) => {
                      if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                          type: "world_update",
                          players: players,
                          items: worldItems
                        }));
                      }
                    });
                  }
                }, collectionTime);
              } else if (item.collectorId !== playerId) {
                // Item is being collected by someone else
                ws.send(JSON.stringify({
                  type: "collection_error",
                  message: "This item is being collected by another player"
                }));
              }
            } else {
              console.log("Item too far away for collection");
              ws.send(JSON.stringify({
                type: "collection_error",
                message: "Item is too far away to collect"
              }));
            }
          } else {
            console.log("Item not found in world items:", data.itemId);
          }
          break;

        case "add_to_inventory":
          // This case is now handled by collection_complete
          console.log("add_to_inventory request ignored, using collection system instead");
          break;

        case "cancel_collection":
          const cancelItemIndex = worldItems.findIndex(item => 
            item.itemId === data.itemId && 
            item.collectorId === playerId
          );

          if (cancelItemIndex !== -1) {
            worldItems[cancelItemIndex].beingCollected = false;
            worldItems[cancelItemIndex].collectorId = null;

            // Notify player collection was canceled
            ws.send(JSON.stringify({
              type: "collection_canceled",
              itemId: data.itemId
            }));
          }
          break;

        case "use_item":
          const itemId = data.itemId;
          // Find the item in player's inventory
          const inventoryItemIndex = players[playerId].inventory.findIndex(item => item.itemId === itemId);

          if (inventoryItemIndex !== -1) {
              const item = players[playerId].inventory[inventoryItemIndex];

              // Handle different item types
              if (item.type === 'consumable') {
                  // Health potions or other consumables
                  if (item.stats && item.stats.heal) {
                      players[playerId].hp = Math.min(100, players[playerId].hp + item.stats.heal);
                      // Remove item after use
                      players[playerId].inventory.splice(inventoryItemIndex, 1);

                      // Notify player
                      ws.send(JSON.stringify({
                          type: "item_used",
                          message: `You used ${item.name} and gained ${item.stats.heal} health!`,
                          newHP: players[playerId].hp,
                          actionType: "heal",
                          amount: item.stats.heal
                      }));
                  }
              } else if (item.type === 'weapon') {
                  // Weapons - put player in "attack mode" to select a target
                  ws.send(JSON.stringify({
                      type: "weapon_ready",
                      message: `You ready your ${item.name}. Click on a player to attack!`,
                      weaponId: item.itemId,
                      damage: item.stats.attack || 5
                  }));
                  // The actual attack will be handled by the "attack_player" message
                  // We don't remove weapons after readying them
              } else if (item.type === 'armor') {
                  // Equipment items - equip the armor
                  ws.send(JSON.stringify({
                      type: "item_used",
                      message: `You equipped your ${item.name}!`,
                      actionType: "equip"
                  }));
                  // Remove the armor from inventory (consumed on equip)
                  players[playerId].inventory.splice(inventoryItemIndex, 1);
              } else {
                  // Generic item use
                  ws.send(JSON.stringify({
                      type: "item_used",
                      message: `You used ${item.name}!`,
                      actionType: "generic"
                  }));
                  // Remove generic items after use
                  players[playerId].inventory.splice(inventoryItemIndex, 1);
              }
          }
          break;
          
        case "attack_player":
          // Handle player attacking another player with a weapon
          const targetPlayerId = data.targetPlayerId;
          const weaponId = data.weaponId;
          const damage = data.damage || 5; // Default damage if not specified
          
          // Verify target exists
          if (players[targetPlayerId]) {
              // Find weapon in inventory
              const weaponIndex = players[playerId].inventory.findIndex(item => 
                  item.itemId === weaponId && item.type === 'weapon'
              );
              
              if (weaponIndex !== -1) {
                  const weapon = players[playerId].inventory[weaponIndex];
                  
                  // Check if target is nearby (within 0.0002 units, roughly 20m)
                  const attackerPos = players[playerId].position;
                  const targetPos = players[targetPlayerId].position;
                  const dist = Math.sqrt(
                      Math.pow(targetPos.lat - attackerPos.lat, 2) + 
                      Math.pow(targetPos.lng - attackerPos.lng, 2)
                  );
                  
                  if (dist <= 0.0002) {
                      // Apply damage to target
                      players[targetPlayerId].hp = Math.max(0, players[targetPlayerId].hp - damage);
                      
                      // Notify attacker
                      ws.send(JSON.stringify({
                          type: "attack_success",
                          message: `You hit ${players[targetPlayerId].name} for ${damage} damage!`,
                          targetName: players[targetPlayerId].name,
                          damage: damage
                      }));
                      
                      // Notify target (if online)
                      const targetClient = Array.from(wss.clients).find(client => 
                          client.readyState === WebSocket.OPEN && 
                          clientSessions.get(client.clientId) === targetPlayerId
                      );
                      
                      if (targetClient) {
                          targetClient.send(JSON.stringify({
                              type: "attacked",
                              message: `You were attacked by ${players[playerId].name} for ${damage} damage!`,
                              attackerName: players[playerId].name,
                              damage: damage,
                              currentHP: players[targetPlayerId].hp
                          }));
                      }
                      
                      // Check if weapon should be consumed (making all weapons single-use)
                      // You can modify this logic based on weapon rarity, type, etc.
                      const consumeWeapon = false; // Set to false if you want reusable weapons
                      
                      if (consumeWeapon) {
                          // Remove weapon after use
                          players[playerId].inventory.splice(weaponIndex, 1);
                          
                          // Notify about weapon consumption
                          ws.send(JSON.stringify({
                              type: "item_used",
                              message: `Your ${weapon.name} broke after use!`,
                              actionType: "weapon_consumed"
                          }));
                      }
                  } else {
                      // Target too far
                      ws.send(JSON.stringify({
                          type: "attack_failed",
                          message: "Target is too far away to attack!"
                      }));
                  }
              } else {
                  // Weapon not found
                  ws.send(JSON.stringify({
                      type: "attack_failed",
                      message: "Weapon not found in your inventory!"
                  }));
              }
          } else {
              // Target not found
              ws.send(JSON.stringify({
                  type: "attack_failed",
                  message: "Target player not found!"
              }));
          }
          break;
          
        case "heal_player":
          // Handle healing another player
          const healTargetId = data.targetPlayerId;
          const healItemId = data.itemId;
          const healAmount = data.healAmount || 20; // Default heal amount if not specified
          
          // Verify target exists
          if (players[healTargetId]) {
              // Find the healing item in inventory
              const healItemIndex = players[playerId].inventory.findIndex(item => 
                  item.itemId === healItemId && item.type === 'consumable'
              );
              
              if (healItemIndex !== -1) {
                  const healItem = players[playerId].inventory[healItemIndex];
                  
                  // Check if target is nearby (within 0.0002 units, roughly 20m)
                  const healerPos = players[playerId].position;
                  const targetPos = players[healTargetId].position;
                  const dist = Math.sqrt(
                      Math.pow(targetPos.lat - healerPos.lat, 2) + 
                      Math.pow(targetPos.lng - healerPos.lng, 2)
                  );
                  
                  if (dist <= 0.0002) {
                      // Apply healing to target
                      const actualHealAmount = healItem.stats?.heal || healAmount;
                      players[healTargetId].hp = Math.min(100, players[healTargetId].hp + actualHealAmount);
                      
                      // Remove healing item after use
                      players[playerId].inventory.splice(healItemIndex, 1);
                      
                      // Notify healer
                      ws.send(JSON.stringify({
                          type: "heal_success",
                          message: `You healed ${players[healTargetId].name} for ${actualHealAmount} health!`,
                          targetName: players[healTargetId].name,
                          healAmount: actualHealAmount
                      }));
                      
                      // Notify target (if online)
                      const targetClient = Array.from(wss.clients).find(client => 
                          client.readyState === WebSocket.OPEN && 
                          clientSessions.get(client.clientId) === healTargetId
                      );
                      
                      if (targetClient) {
                          targetClient.send(JSON.stringify({
                              type: "healed",
                              message: `You were healed by ${players[playerId].name} for ${actualHealAmount} health!`,
                              healerName: players[playerId].name,
                              healAmount: actualHealAmount,
                              currentHP: players[healTargetId].hp
                          }));
                      }
                  } else {
                      // Target too far
                      ws.send(JSON.stringify({
                          type: "heal_failed",
                          message: "Target is too far away to heal!"
                      }));
                  }
              } else {
                  // Healing item not found
                  ws.send(JSON.stringify({
                      type: "heal_failed",
                      message: "Healing item not found in your inventory!"
                  }));
              }
          } else {
              // Target not found
              ws.send(JSON.stringify({
                  type: "heal_failed",
                  message: "Target player not found!"
              }));
          }
          break;
          
        case "drop_item":
          const dropItemId = data.itemId;
          // Find the item in player's inventory
          const dropItemIndex = players[playerId].inventory.findIndex(item => item.itemId === dropItemId);
          
          if (dropItemIndex !== -1) {
              const droppedItem = players[playerId].inventory[dropItemIndex];
              
              // Remove from inventory
              players[playerId].inventory.splice(dropItemIndex, 1);
              
              // Create a new world item at player's position with a new ID to avoid collection conflicts
              const newWorldItem = {
                  ...droppedItem,
                  itemId: `${droppedItem.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`, // Generate new ID
                  position: players[playerId].position,
                  collectionTime: 1000, // Allow quick pickup
                  beingCollected: false, // Ensure it's not marked as being collected
                  collectorId: null     // Clear any collector ID
              };
              
              // Add to world items
              worldItems.push(newWorldItem);
              
              // Notify player
              ws.send(JSON.stringify({
                  type: "item_dropped",
                  message: `You dropped ${droppedItem.name}.`,
                  itemName: droppedItem.name
              }));
          }
          break;

        case "view_profile":
          // Anyone can view profiles, so no security check needed
          const profilePlayerId = data.profilePlayerId;
          if (players[profilePlayerId]) {
            // Send back the profile data for the requested player
            ws.send(JSON.stringify({
              type: "profile_data",
              playerProfile: players[profilePlayerId],
              isOwnProfile: profilePlayerId === playerId
            }));
          }
          break;
        case "update_profile":
          // Only allow updating specific fields to prevent security issues
          if (data.name) {
            // Sanitize name
            const sanitizedName = data.name.replace(/[^\w\s-]/gi, '').substring(0, 20);
            players[playerId].name = sanitizedName;
          }
          break;

        case "update_avatar":
          // Verify that the selected avatar exists in our list
          if (avatars.includes(data.avatar)) {
            players[playerId].avatar = data.avatar;
          }
          break;
      }

      // Broadcast updated state to all clients
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: "world_update",
            players: players,
            items: worldItems
          }));
        }
      });
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  ws.on("close", () => {
    console.log(`Client ${clientId} (Player: ${playerId}) disconnected`);
    // Clean up session and player
    clientSessions.delete(clientId);
    delete players[playerId];

    // Notify others
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: "player_left",
          playerId: playerId
        }));
      }
    });
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server available at: ws://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
  console.log(`Client available at: https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
});