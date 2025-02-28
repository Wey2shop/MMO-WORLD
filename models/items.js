
// Item template system for creating different types of items
const ItemTypes = {
  WEAPON: 'weapon',
  ARMOR: 'armor',
  CONSUMABLE: 'consumable',
  COLLECTIBLE: 'collectible'
};

// Base item template
class ItemTemplate {
  constructor(id, name, type, rarity, description, imageUrl, stats) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.rarity = rarity; // common, uncommon, rare, legendary
    this.description = description;
    this.imageUrl = imageUrl;
    this.stats = stats || {};
  }
  
  createItem(customProperties = {}) {
    return {
      ...this,
      itemId: `${this.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: new Date(),
      ...customProperties
    };
  }
}

// Item templates
const ITEM_TEMPLATES = {
  // Weapons
  'iron-sword': new ItemTemplate(
    'iron-sword',
    'Iron Sword',
    ItemTypes.WEAPON,
    'common',
    'A basic iron sword',
    '/images/items/iron-sword.png',
    { attack: 5 }
  ),
  'steel-sword': new ItemTemplate(
    'steel-sword',
    'Steel Sword',
    ItemTypes.WEAPON,
    'uncommon',
    'A stronger steel sword',
    '/images/items/steel-sword.png',
    { attack: 10 }
  ),
  
  // Armor
  'leather-armor': new ItemTemplate(
    'leather-armor',
    'Leather Armor',
    ItemTypes.ARMOR,
    'common',
    'Basic leather protection',
    '/images/items/leather-armor.png',
    { defense: 3 }
  ),
  
  // Consumables
  'health-potion': new ItemTemplate(
    'health-potion',
    'Health Potion',
    ItemTypes.CONSUMABLE,
    'common',
    'Restores 20 health points',
    '/images/items/health-potion.png',
    { heal: 20 }
  ),
  
  // Collectibles
  'gold-coin': new ItemTemplate(
    'gold-coin',
    'Gold Coin',
    ItemTypes.COLLECTIBLE,
    'common',
    'A shiny gold coin',
    '/images/items/gold-coin.png',
    { value: 1 }
  ),
};

// Function to create an item from a template
function createItemFromTemplate(templateId, customProperties = {}) {
  const template = ITEM_TEMPLATES[templateId];
  if (!template) {
    throw new Error(`Item template ${templateId} not found`);
  }
  return template.createItem(customProperties);
}

module.exports = {
  ItemTypes,
  ItemTemplate,
  ITEM_TEMPLATES,
  createItemFromTemplate
};
