import { test, expect } from '@playwright/test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getAuth } from 'firebase/auth';

// Test data
const TEST_USER_EMAIL = 'test-user@example.com';
const TEST_USER_PASSWORD = 'TestPassword123';
const TEST_USER_ID = 'test-user-id';
const TEST_WALLET_ADDRESS = '0x123456789abcdef0123456789abcdef012345678';

let testEnv: RulesTestEnvironment;

test.beforeAll(async () => {
  // Initialize the Firebase emulator test environment
  testEnv = await initializeTestEnvironment({
    projectId: 'milestone-tracker-15187',
    firestore: { host: 'localhost', port: 8081 }
  });
});

test.afterAll(async () => {
  await testEnv.cleanup();
});

test.describe('Firestore Security Rules Tests', () => {
  test('unauthenticated users cannot read user documents', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    
    // try to read a user document as an unauthenticated user
    const userDocRef = doc(db, 'users', TEST_USER_ID);
    await expect(getDoc(userDocRef)).rejects.toThrow();
  });
  
  test('users can read their own documents', async () => {
    // create a test user context
    const userContext = testEnv.authenticatedContext(TEST_USER_ID);
    const db = userContext.firestore();
    
    // set up test data
    await setDoc(doc(db, 'users', TEST_USER_ID), {
      email: TEST_USER_EMAIL,
      creationDate: new Date()
    });
    
    // read the user document as the authenticated user
    const userDocRef = doc(db, 'users', TEST_USER_ID);
    const snapshot = await getDoc(userDocRef);
    expect(snapshot.exists()).toBe(true);
    expect(snapshot.data()?.email).toBe(TEST_USER_EMAIL);
  });
  
  test('users cannot read other users documents', async () => {
    const otherUserContext = testEnv.authenticatedContext('other-user-id');
    const db = otherUserContext.firestore();
    
    // try to read another user's document
    const userDocRef = doc(db, 'users', TEST_USER_ID);
    await expect(getDoc(userDocRef)).rejects.toThrow();
  });
  
  test('users can create their own wallet documents', async () => {
    const userContext = testEnv.authenticatedContext(TEST_USER_ID);
    const db = userContext.firestore();
    
    // create wallet document
    const walletDocRef = doc(db, 'users', TEST_USER_ID, 'wallet', 'wallet_info');
    await setDoc(walletDocRef, {
      address: TEST_WALLET_ADDRESS,
      balance: '100'
    });
    
    // verify wallet document was created
    const walletSnapshot = await getDoc(walletDocRef);
    expect(walletSnapshot.exists()).toBe(true);
    expect(walletSnapshot.data()?.address).toBe(TEST_WALLET_ADDRESS);
  });
  
  test('users cannot modify other users wallet documents', async () => {
    const otherUserContext = testEnv.authenticatedContext('other-user-id');
    const db = otherUserContext.firestore();
    
    // try to modify another users wallet
    const walletDocRef = doc(db, 'users', TEST_USER_ID, 'wallet', 'wallet_info');
    await expect(
      setDoc(walletDocRef, { 
        address: '0xhacked', 
        balance: '999999' 
      })
    ).rejects.toThrow();
  });
  
  test('global wallet addresses can be read by authenticated users', async () => {
    // Use withSecurityRulesDisabled to set up test data without permissions issues
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      
      await setDoc(doc(adminDb, 'wallets', TEST_WALLET_ADDRESS), {
        userId: TEST_USER_ID,
        address: TEST_WALLET_ADDRESS,
        createdAt: Date.now()
      });
    });
    
    // Test that an authenticated user can read wallet data
    const userContext = testEnv.authenticatedContext('some-other-user');
    const db = userContext.firestore();
    
    const walletDocRef = doc(db, 'wallets', TEST_WALLET_ADDRESS);
    const snapshot = await getDoc(walletDocRef);
    expect(snapshot.exists()).toBe(true);
    expect(snapshot.data()?.address).toBe(TEST_WALLET_ADDRESS);
  });
  
  test('unauthenticated users cannot read wallet addresses', async () => {
    // First ensure the test document exists
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      
      await setDoc(doc(adminDb, 'wallets', TEST_WALLET_ADDRESS), {
        userId: TEST_USER_ID,
        address: TEST_WALLET_ADDRESS,
        createdAt: Date.now()
      });
    });

    const db = testEnv.unauthenticatedContext().firestore();
    
    const walletDocRef = doc(db, 'wallets', TEST_WALLET_ADDRESS);
    await expect(getDoc(walletDocRef)).rejects.toThrow();
  });
  
  test('anyone cannot read milestone documents', async () => {
    // set up test milestone data
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();

      const milestoneId = 'private-milestone-1';
      await setDoc(doc(adminDb, 'milestones', milestoneId), {
        owner: 'some-user',
        description: 'Private milestone for testing',
        verified: true,
        timestamp: Date.now()
      });
    });

    // test that an unauthenticated user cannot read milestone data
    const db = testEnv.unauthenticatedContext().firestore();

    const milestoneDocRef = doc(db, 'milestones', 'private-milestone-1');
    await expect(getDoc(milestoneDocRef)).rejects.toThrow();
  });
});