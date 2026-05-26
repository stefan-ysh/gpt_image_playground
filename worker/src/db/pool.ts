import mysql from 'mysql2/promise'
import { config } from '../config.js'

export const pool = mysql.createPool({
  uri: config.mysqlUrl,
  waitForConnections: true,
  connectionLimit: 10,
})