import { Request, Response } from "express";
import { WebSocketServer } from "ws";
import Transaction from "../models/Transaction.js";
import { sendError } from "../utils/response.js";
import { validationResult } from "express-validator";
import { broadcastTransactionUpdate } from "../websocket.js";

export const createTransaction = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 400, { message: errors.array()[0].msg });

  const { userId } = req.user!;
  const { amount, type, category, description } = req.body;

  const transaction = new Transaction({ userId, amount, type, category, description, status: "Pending", date: new Date() });
  await transaction.save();
  res.status(201).json({ message: "Transaction created", transaction });
};

export const getTransactions = async (req: Request, res: Response) => {
  const { userId } = req.user!;
  const { startDate, endDate, category, status, page = '1', limit = '10' } = req.query;

  const query: any = { userId };
  if (startDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate as string)) {
      return sendError(res, 400, { message: "Invalid startDate format (YYYY-MM-DD)" });
    }
    query.date = { $gte: new Date(startDate as string) };
  }
  if (endDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate as string)) {
      return sendError(res, 400, { message: "Invalid endDate format (YYYY-MM-DD)" });
    }
    query.date = { ...query.date, $lte: new Date(endDate as string) };
  }
  if (category) query.category = category;
  if (status) query.status = status;

  const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 10));
  const skip = (pageNum - 1) * limitNum;

  const transactions = await Transaction.find(query)
    .sort({ date: -1 })
    .skip(skip)
    .limit(limitNum);
  const total = await Transaction.countDocuments(query);

  res.json({
    transactions,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum)
    }
  });
};

export const updateTransactionStatus = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 400, { message: errors.array()[0].msg });

  const { userId } = req.user!;
  const { transactionId, status } = req.body;

  const transaction = await Transaction.findOne({ _id: transactionId, userId });
  if (!transaction) return sendError(res, 404, { message: "Transaction not found" });

  transaction.status = status;
  await transaction.save();

  const wss = req.app.get('wss') as WebSocketServer | undefined;
  if (wss) {
    broadcastTransactionUpdate(wss, transaction);
  }

  res.json({ message: "Transaction status updated", transaction });
};

export const exportTransactions = async (req: Request, res: Response) => {
  const { userId } = req.user!;
  const transactions = await Transaction.find({ userId }).lean();
  const csv = transactions.map(t => `${t.date.toISOString()},${t.type},${t.amount},${t.category || ''},${t.status},${t.description || ''}`).join('\n');
  res.header('Content-Type', 'text/csv');
  res.attachment('transactions.csv');
  res.send(`Date,Type,Amount,Category,Status,Description\n${csv}`);
};
