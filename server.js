const express = require('express');
const admin = require('firebase-admin');
const { v1: uuidv1 } = require('uuid');

// Initialize Firebase Admin SDK
const serviceAccount = require('./spiritualledcandle-firebase-admin.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const firestore = admin.firestore();
const app = express();
const port = 3000;

// Default values for new stands
const defaultValues = {
  address: "DefaultAddress",
  balance: 0,
  currency: 1,
  isactive: true,
  latitude: 0,
    longitude: 0,
    message: "DefaultMessage",
    price1: 0,
    price2: 0,
    uid: "Unassigned"
};

const timers = {};
const onlineTransaction = {};
const pendingOnlineTransactions = {};
const confirmationTimer={};

app.get('/test', (req, res) => {
  console.log("Request received");
  res.json({ message: 'Hello, World!' });
});

app.get('/startup', async (req, res) => {
    const serialNumber = req.query.serialnumber;
    const candlesOn = req.query.candlesOn;
    const stid = uuidv1();
    const totalcandles = req.query.totalcandles;

    onlineTransaction[serialNumber] = [];
    pendingOnlineTransactions[serialNumber] = false;

    if (timers[serialNumber]) {
        clearTimeout(timers[serialNumber]);
      }

    if (!serialNumber || !candlesOn || !stid || !totalcandles) {
      return res.status(400).json({ error: 'Parameters missing (1 or more): serialNumber, candlesOn, stid, totalcandles' });
    }
  
    try {
      const standsRef = firestore.collection('stands');
      const snapshot = await standsRef.get();
  
      let standFound = null;
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.serialnumber === serialNumber) {
          standFound = { id: doc.id, ...data };
        }
      });
  
      if (standFound) {
        res.json({
          message: standFound.message,
          price1: standFound.price1,
          price2: standFound.price2,
          currency: standFound.currency
        });
        await standsRef.doc(standFound.stid).update({ isactive: true });
      } else {
        const newStandRef = standsRef.doc(stid);
        const newStandData = { ...defaultValues, serialnumber: serialNumber, candlesOn: parseInt(candlesOn,10), stid: stid , totalcandles: parseInt(totalcandles,10)};
        await newStandRef.set(newStandData);
        res.json(newStandData);
      }
    } catch (error) {
      console.error('Error accessing Firestore:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
    
    timers[serialNumber] = setTimeout(async () => {
        try {
          const standsRef = firestore.collection('stands');
          const snapshot = await standsRef.where('serialnumber', '==', serialNumber).get();
  
          if (!snapshot.empty) {
            const standDoc = snapshot.docs[0];
            await standDoc.ref.update({ isactive: false });
            console.log(`Stand with serial number ${serialNumber} set to inactive due to timeout.`);
          }
        } catch (error) {
          console.error('Error updating Firestore:', error);
        }
      }, 10000);

  });
  
  app.get('/alive', async (req, res) => {
    const serialNumber = req.query.serialnumber;
    const candlesOn = req.query.candlesOn;
    //const totalcandles = req.query.totalcandles;
    const transactiontotal = req.query.transactiontotal;
    //const transactioncandles = req.query.transactioncandles;

    if (!serialNumber || !candlesOn || !transactiontotal) {
      return res.status(400).json({ error: 'Parameters missing ' });
    }
    
    try {
        const standsRef = firestore.collection('stands');
        const snapshot = await standsRef.get();
    
        let standFound = null;
        snapshot.forEach(doc => {
          const data = doc.data();
          if (data.serialnumber === serialNumber) {
            standFound = { id: doc.id, ...data };
          }
        });
        if (transactiontotal > 0) {
            const transactionsRef = firestore.collection('transactions');
            const trzid = uuidv1();
            const newTransactionData = {
                amount: parseInt(transactiontotal),
                content: "no message",
                isconfirmed: true,
                isonline: false,
                stid: standFound.stid,
                timestamp: new Date().toISOString(),
                trzid: trzid
            };
            await transactionsRef.doc(trzid).set(newTransactionData);

            await standsRef.doc(standFound.stid).update({ candlesOn: parseInt(candlesOn)});//, balance: standFound.balance + parseInt(transactiontotal) });
        }
        else
        {
            await standsRef.doc(standFound.stid).update({ candlesOn: parseInt(candlesOn) });
        }
   
    if (timers[serialNumber]) {
      clearTimeout(timers[serialNumber]);
    }

    timers[serialNumber] = setTimeout(async () => {
      try {
        const standsRef = firestore.collection('stands');
        const snapshot = await standsRef.where('serialnumber', '==', serialNumber).get();

        if (!snapshot.empty) {
          const standDoc = snapshot.docs[0];
          await standDoc.ref.update({ isactive: false });
          console.log(`Stand with serial number ${serialNumber} set to inactive due to timeout.`);
        }
      } catch (error) {
        console.error('Error updating Firestore:', error);
      }
    }, 10000);

    const transactionsRef = firestore.collection('transactions');
    const transactionsSnapshot = await transactionsRef.where('stid', '==', standFound.stid).get();

    pendingOnlineTransactions[serialNumber] = false;
    let total = 0;
    let totalcandles = 0;

    transactionsSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.isonline && !data.isconfirmed) {
            pendingOnlineTransactions[serialNumber] = true;
            total += data.amount;
            totalcandles += data.candles;
            onlineTransaction[serialNumber].push(data.trzid);
        }
    });

    if (pendingOnlineTransactions[serialNumber]) {
            
        if (confirmationTimer[serialNumber]) {
            clearTimeout(confirmationTimer[serialNumber]);
        }

        confirmationTimer[serialNumber] = setTimeout(async () => {
            try {
                if (onlineTransaction[serialNumber]) {
                    const batch = firestore.batch();
                    onlineTransaction[serialNumber].forEach(transaction => {
                        console.log(`Deleting transaction ${transaction} due to timeout.`);
                        const transactionRef = firestore.collection('transactions').doc(transaction);
                        batch.delete(transactionRef);
                    });

                    await batch.commit();
                    onlineTransaction[serialNumber] = [];
                    console.log(`Online transactions for serial number ${serialNumber} deleted due to timeout.`);
                }
            } catch (error) {
                console.error('Error deleting transactions from Firestore:', error);
            }
        }, 3000); // Set the timeout duration as needed (e.g., 60000 ms = 1 minute)

        res.json({
            action: 1,
            message: "OK",
            total: total,
            totalcandles: totalcandles
        });
    }
    else
    {
        res.json({
            action: 0,
            message: "OK"
            });
    } }
    catch (error) {
        console.error('Error accessing Firestore:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }

  });

  app.get('/confirm', async (req, res) => {
    const serialNumber = req.query.serialnumber;
    if (!serialNumber) {
      return res.status(400).json({ error: 'Parameters missing ' });
    }

    if (confirmationTimer[serialNumber]) {
        clearTimeout(confirmationTimer[serialNumber]);
    }
    
    try {
        if (onlineTransaction[serialNumber]) {
            const batch = firestore.batch();
            onlineTransaction[serialNumber].forEach(transaction => {
                const transactionRef = firestore.collection('transactions').doc(transaction);
                batch.update(transactionRef, { isconfirmed: true });
            });

            await batch.commit();
            onlineTransaction[serialNumber] = [];
        }

        res.json({ message: 'Transactions confirmed' });
    }
    catch (error) {
        console.error('Error accessing Firestore:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }

  });

  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });

//test comment
