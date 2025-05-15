import React, { useEffect, useState } from 'react';
import { collection, doc, getDoc, getFirestore, query, where, orderBy, getDocs } from 'firebase/firestore';
import { formatDistanceToNow } from 'date-fns';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { app } from "../../../firebase/client"

interface Transaction {
  id: string;
  from: string;
  to: string;
  amount: string;
  timestamp: string;
  txHash: string;
}

interface TransactionHistoryProps {
  currentUser: any
}

export default function TransactionHistory({ currentUser }: TransactionHistoryProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userAddress, setUserAddress] = useState<string | null>(null);

  useEffect(() => {
    // Existing fetch logic remains the same
    const fetchTransactions = async () => {
      try {
        setLoading(true);
        const db = getFirestore(app);

        // Get user's wallet address
        const walletSnapshot = await getDoc(
          doc(db, "users", currentUser.uid, "wallet", "wallet_info")
        );

        if (!walletSnapshot.exists()) {
          throw new Error("Wallet not found");
        }

        const walletData = walletSnapshot.data();
        const address = walletData.address;
        setUserAddress(address);

        if (!address) {
          throw new Error("Wallet address not found");
        }

        // Query transactions where user is either sender or recipient
        const transactionsRef = collection(db, "transactions");
        
        // Create two queries: one for sent transactions and one for received
        const sentQuery = query(
          transactionsRef,
          where("from", "==", address),
          orderBy("timestamp", "desc")
        );
        
        const receivedQuery = query(
          transactionsRef,
          where("to", "==", address),
          orderBy("timestamp", "desc")
        );

        // Execute both queries
        const [sentSnapshot, receivedSnapshot] = await Promise.all([
          getDocs(sentQuery),
          getDocs(receivedQuery)
        ]);

        // Combine and process transactions
        const allTransactions: Transaction[] = [];

        sentSnapshot.forEach(doc => {
          allTransactions.push({
            id: doc.id,
            ...doc.data()
          } as Transaction);
        });

        receivedSnapshot.forEach(doc => {
          // Avoid duplicates if a transaction is both sent and received by the same address
          if (!allTransactions.some(tx => tx.id === doc.id)) {
            allTransactions.push({
              id: doc.id,
              ...doc.data()
            } as Transaction);
          }
        });

        // Sort by timestamp (most recent first)
        allTransactions.sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        setTransactions(allTransactions);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching transactions:", err);
        setError('Failed to load transactions');
        setLoading(false);
      }
    };

    fetchTransactions();
  }, [currentUser.uid]);

  const formatAmount = (amount: string) => {
    const etherAmount = parseFloat(amount) / 1e18;
    return etherAmount.toFixed(4);
  };

  const isSentTransaction = (tx: Transaction) => {
    return userAddress && tx.from.toLowerCase() === userAddress.toLowerCase();
  };

  const formatAddress = (address: string) => {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  return (
    <Card className="bg-[#1a1a1a] border border-purple-500/20 shadow-lg overflow-hidden w-full">
      <CardHeader className="border-b border-[#333333] pb-4">
        <CardTitle className="text-white text-xl">Transaction History</CardTitle>
        <CardDescription className="text-gray-400">
          View your recent transactions
        </CardDescription>
      </CardHeader>
      <CardContent className="p-3 sm:p-6 space-y-4 bg-[#1a1a1a]">
        <Tabs defaultValue="all">
          <TabsList className="mb-4 bg-[#222] border-[#333] w-full justify-start overflow-x-auto">
            <TabsTrigger value="all" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white">All</TabsTrigger>
            <TabsTrigger value="sent" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white">Sent</TabsTrigger>
            <TabsTrigger value="received" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white">Received</TabsTrigger>
          </TabsList>

          {error && <p className="p-3 bg-red-900/30 text-red-400 rounded-md text-sm">{error}</p>}

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center space-x-4 p-3 bg-[#222] rounded-md">
                  <div className="space-y-2 w-full">
                    <Skeleton className="h-4 w-full sm:w-[250px] bg-[#333]" />
                    <Skeleton className="h-4 w-3/4 sm:w-[200px] bg-[#333]" />
                    <Skeleton className="h-4 w-1/2 sm:w-[150px] bg-[#333]" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <TabsContent value="all" className="space-y-4 mt-2">
                {transactions.length === 0 ? (
                  <p className="text-center py-4 text-gray-500">No transactions found</p>
                ) : (
                  transactions.map((tx) => (
                    <TransactionItem key={tx.id} transaction={tx} userAddress={userAddress} />
                  ))
                )}
              </TabsContent>

              <TabsContent value="sent" className="space-y-4 mt-2">
                {transactions.filter(tx => isSentTransaction(tx)).length === 0 ? (
                  <p className="text-center py-4 text-gray-500">No sent transactions found</p>
                ) : (
                  transactions
                    .filter(tx => isSentTransaction(tx))
                    .map((tx) => (
                      <TransactionItem key={tx.id} transaction={tx} userAddress={userAddress} />
                    ))
                )}
              </TabsContent>

              <TabsContent value="received" className="space-y-4 mt-2">
                {transactions.filter(tx => !isSentTransaction(tx)).length === 0 ? (
                  <p className="text-center py-4 text-gray-500">No received transactions found</p>
                ) : (
                  transactions
                    .filter(tx => !isSentTransaction(tx))
                    .map((tx) => (
                      <TransactionItem key={tx.id} transaction={tx} userAddress={userAddress} />
                    ))
                )}
              </TabsContent>
            </>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function TransactionItem({ 
  transaction, 
  userAddress 
}: { 
  transaction: Transaction, 
  userAddress: string | null 
}) {
  const isSent = userAddress && transaction.from.toLowerCase() === userAddress.toLowerCase();
  
  const formatAmount = (amount: string) => {
    const etherAmount = parseFloat(amount) / 1e18;
    return etherAmount.toFixed(4);
  };
  
  const formatAddress = (address: string) => {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };
  
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 bg-[#222] rounded-md border border-[#333] hover:border-purple-500/30 transition-colors gap-2">
      <div className="w-full sm:flex-1 min-w-0">
        <div className="flex flex-col xs:flex-row xs:items-center gap-2 mb-1">
          <Badge variant={isSent ? "destructive" : "success"} className={`${isSent ? "bg-red-900/50 text-red-400 hover:bg-red-900/70" : "bg-green-900/50 text-green-400 hover:bg-green-900/70"} inline-flex whitespace-nowrap`}>
            {isSent ? "Sent" : "Received"}
          </Badge>
          <span className="text-xs sm:text-sm text-gray-500">
            {formatDistanceToNow(new Date(transaction.timestamp), { addSuffix: true })}
          </span>
        </div>
        
        <div className="mt-1 text-gray-300 text-sm sm:text-base">
          {isSent ? (
            <div className="flex flex-col xs:flex-row gap-1 xs:items-center">
              <span className="whitespace-nowrap">To:</span>
              <span className="overflow-hidden text-ellipsis" style={{ wordBreak: 'break-all' }}>
                <span className="hidden sm:inline">{transaction.to}</span>
                <span className="inline sm:hidden">{formatAddress(transaction.to)}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(transaction.to)}
                  className="ml-1 text-purple-400 hover:text-purple-300 focus:outline-none"
                  title="Copy address"
                >
                  📋
                </button>
              </span>
            </div>
          ) : (
            <div className="flex flex-col xs:flex-row gap-1 xs:items-center">
              <span className="whitespace-nowrap">From:</span>
              <span className="break-all">{transaction.from}</span>
              <button
                onClick={() => navigator.clipboard.writeText(transaction.from)}
                className="ml-1 text-purple-400 hover:text-purple-300 focus:outline-none"
                title="Copy address"
              >
                📋
              </button>
            </div>
          )}
        </div>
        
        <a 
          href={`https://sepolia.etherscan.io/tx/${transaction.txHash}`} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-xs text-purple-400 hover:text-purple-300 hover:underline"
        >
          View on Etherscan
        </a>
      </div>
      
      <div className="w-full sm:w-auto text-left sm:text-right mt-2 sm:mt-0">
        <p className={`font-semibold ${isSent ? "text-red-400" : "text-green-400"}`}>
          {isSent ? "-" : "+"}{formatAmount(transaction.amount)} MST
        </p>
      </div>
    </div>
  );
}