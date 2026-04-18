require('dotenv').config();
const db = require('./firebase');

const menuItems = [
  { name: 'Vada Pav', price: 20, category: 'snacks' },
  { name: 'Samosa', price: 15, category: 'snacks' },
  { name: 'Chai', price: 10, category: 'drinks' },
  { name: 'Cold Coffee', price: 40, category: 'drinks' },
];

async function seed() {
  // Add menu items
  for (const item of menuItems) {
    await db.collection('menu_items').add(item);
    console.log('Added:', item.name);
  }

  // Create shop config (tracks current token number)
  await db.collection('shop_config').doc('main').set({
    currentToken: 0,
    lastServedToken: 0,
    isOpen: true
  });

  console.log('Database seeded!');
  process.exit();
}

seed();