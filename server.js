require('dotenv').config();

// At top of server.js, add:
const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./firebase');   // ← add this
const { getAuth } = require('firebase-admin/auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));
// authentication owner something related 
async function ownerOnly(req, res, next) {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    
    const decoded = await getAuth().verifyIdToken(token);
    
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'owner') {
      return res.status(403).json({ error: 'Not authorized as owner' });
    }
    
    next();
  } catch(e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}


// Test route
app.get('/ping', (req, res) => {
  res.json({ message: 'Queue system is alive!' });
});

// Fetch menu items
app.get('/menu', async (req, res) => {
  try{
  const snapshot = await db.collection('menu_items').get();
  const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  res.json(items);}
  catch(err){}
  console.error("server error",err)
   res.status(500).json({ error: 'Failed to items  user' }); // Prevents a silent crash
});

//authentication route(owner)
app.post('/auth/register', async (req, res) => {
  try {
    const { uid, email, role } = req.body;
    await db.collection('users').doc(uid).set({ 
      email, role, createdAt: new Date() 
    });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Add menu item
app.post('/owner/menu/add', ownerOnly, async (req, res) => {
  try {
    const { name, price, category } = req.body;
    const doc = await db.collection('menu_items').add({ 
      name, price: Number(price), category, createdAt: new Date() 
    });
    res.json({ success: true, id: doc.id });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Edit menu item
app.put('/owner/menu/:id', ownerOnly, async (req, res) => {
  try {
    const { name, price, category } = req.body;
    await db.collection('menu_items').doc(req.params.id).update({ 
      name, price: Number(price), category 
    });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete menu item
app.delete('/owner/menu/:id', ownerOnly, async (req, res) => {
  try {
    await db.collection('menu_items').doc(req.params.id).delete();
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Socket.io connection
io.on('connection', (socket) => {
  console.log('A client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Clear old queue records older than 24 hours
async function clearOldQueue() {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const oldSnap = await db.collection('queue')
      .where('createdAt', '<', cutoff).get();

    const batch = db.batch();
    oldSnap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    // Reset token counters
    await db.collection('shop_config').doc('main').update({
      currentToken: 0,
      lastServedToken: 0
    });

    console.log(`Cleared ${oldSnap.size} old queue records`);
  } catch(e) {
    console.error('Clear queue error:', e.message);
  }
}

// Run once when server starts
clearOldQueue();

// Then run every 24 hours
setInterval(clearOldQueue, 24 * 60 * 60 * 1000);



// Create Razorpay order
app.post('/payment/create-order', async (req, res) => {
  const { amount, items } = req.body;
  const order = await razorpay.orders.create({
    amount: amount * 100, // paise
    currency: 'INR',
    receipt: `receipt_${Date.now()}`,
  });
  res.json({ orderId: order.id, amount: order.amount, razorpayKeyId: process.env.RAZORPAY_KEY_ID });
});

// Verify payment + assign token
app.post('/payment/verify', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, items, totalAmount } = req.body;

  const sign = razorpay_order_id + '|' + razorpay_payment_id;
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(sign).digest('hex');

  if (expected !== razorpay_signature) return res.json({ success: false });

  // Assign token
  const configRef = db.collection('shop_config').doc('main');
  const config = await configRef.get();
  const newToken = (config.data().currentToken || 0) + 1;
  await configRef.update({ currentToken: newToken });

  // Save to queue
  await db.collection('queue').add({
    token: newToken, items, totalAmount,
    status: 'waiting', createdAt: new Date()
  });

  const queueSnap = await db.collection('queue').where('status', '==', 'waiting').get();
  const position = queueSnap.size;

  io.emit('queue-updated', { currentToken: config.data().lastServedToken || 0, waitingCount: position });

  res.json({ success: true, token: newToken, position });
});

// temporarry skipping payment
app.post('/join-queue', async (req, res) => {
  try {
    const { items, totalAmount } = req.body;
    const configRef = db.collection('shop_config').doc('main');
    const config = await configRef.get();
    const newToken = (config.data().currentToken || 0) + 1;
    await configRef.update({ currentToken: newToken });

    await db.collection('queue').add({
      token: newToken, items, totalAmount,
      status: 'waiting', createdAt: new Date()
    });

    const queueSnap = await db.collection('queue').where('status', '==', 'waiting').get();
    const position = queueSnap.size;

    io.emit('queue-updated', { 
      lastServedToken: config.data().lastServedToken || 0, 
      waitingCount: position 
    });

    res.json({ success: true, token: newToken, position });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get full queue for owner
app.get('/owner/queue', async (req, res) => {
  try {
    const configSnap = await db.collection('shop_config').doc('main').get();
    const config = configSnap.data();

    const queueSnap = await db.collection('queue')
      .orderBy('token', 'asc').get();
    const queue = queueSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    res.json({
      queue,
      lastServedToken: config.lastServedToken || 0,
      isOpen: config.isOpen
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve next customer
app.post('/owner/next', async (req, res) => {
  try {
    const configRef = db.collection('shop_config').doc('main');
    const config = (await configRef.get()).data();
    const nextToken = (config.lastServedToken || 0) + 1;

    // Find that token in queue
    const snap = await db.collection('queue')
      .where('token', '==', nextToken).get();

    if (snap.empty) {
      return res.json({ success: false, message: 'No one in queue' });
    }

    // Mark as done
    await snap.docs[0].ref.update({ status: 'done' });
    await configRef.update({ lastServedToken: nextToken });

    const waitingSnap = await db.collection('queue')
      .where('status', '==', 'waiting').get();

    io.emit('queue-updated', {
      lastServedToken: nextToken,
      waitingCount: waitingSnap.size
    });

    res.json({ success: true, lastServedToken: nextToken, waitingCount: waitingSnap.size });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Toggle shop open/close
app.post('/owner/toggle-shop', async (req, res) => {
  try {
    const { isOpen } = req.body;
    await db.collection('shop_config').doc('main').update({ isOpen });
    io.emit('shop-status', { isOpen });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});