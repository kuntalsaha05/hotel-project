/*
* =================================================================
* --- NODE.JS / EXPRESS / MYSQL BACKEND SERVER ---
* =================================================================
*
* This server has been RE-WRITTEN to work with your
* new relational database schema.
*
*/

// --- 1. Import necessary libraries ---
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

// --- 2. Initialize the Express App ---
const app = express();
const port = 3000;

// --- 3. Set up Middleware ---
// This allows your server to read JSON and accept requests
// from your 'Live Server' frontend
app.use(express.json());
app.use(cors({
    origin: 'http://127.0.0.1:5500' // Allow requests from Live Server
}));


// --- 4. MySQL Database Connection ---
const dbConfig = {
    host: 'localhost',
    port: 3307, // The port we fixed for XAMPP
    user: 'root',
    password: '',
    database: 'hotel_db'
};

// Create a 'pool' of connections for the database
const pool = mysql.createPool(dbConfig);

/*
* =================================================================
* --- API ENDPOINTS (Updated for new tables) ---
* =================================================================
*/

/**
 * API ENDPOINT: POST /api/login
 * Handles staff login from login.html
 * UPDATED: Queries the new 'Staff' table
 */
app.post('/api/login', async (req, res) => {
    console.log("Login attempt received..."); // Log when this API is hit
    try {
        const { username, password } = req.body;
        
        // Query the new 'Staff' table
        const sql = "SELECT * FROM Staff WHERE Username = ? AND Password = ?";
        
        const [users] = await pool.query(sql, [username, password]);

        if (users.length > 0) {
            console.log("Login successful for:", username);
            res.json({ success: true, message: 'Login successful' });
        } else {
            console.log("Login failed for:", username);
            res.status(401).json({ success: false, message: 'Invalid username or password' });
        }

    } catch (error) {
        console.error("Login API Error:", error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


/**
 * API ENDPOINT: POST /api/bookings
 * Saves a new booking from book-now.html
 * UPDATED: This is now a multi-step process:
 * 1. Create a Guest
 * 2. Find a Room
 * 3. Create a Reservation
 */
app.post('/api/bookings', async (req, res) => {
    console.log("Booking request received..."); // Log when this API is hit
    
    // Get a single connection from the pool to use for a 'transaction'
    // A transaction ensures ALL steps succeed or NONE of them do.
    const connection = await pool.getConnection(); 
    
    try {
        // Start the transaction
        await connection.beginTransaction();

        const { name, email, phone, checkIn, checkOut, roomType, status } = req.body;
        
        // --- Step 1: Create the Guest ---
        // We'll use the email or phone as the main contact info
        console.log("Step 1: Creating Guest...");
        const contactInfo = email || phone;
        const guestSql = "INSERT INTO Guest (Name, Contact_Info) VALUES (?, ?)";
        const [guestResult] = await connection.query(guestSql, [name, contactInfo]);
        const newGuestID = guestResult.insertId;
        console.log("Guest created with ID:", newGuestID);

        // --- Step 2: Find an available Room_No for the requested category ---
        // This query finds a room that matches the category AND is 'clean'
        console.log("Step 2: Finding a clean room...");
        const roomSql = "SELECT Room_No FROM Room WHERE Category = ? AND Status = 'clean' LIMIT 1";
        const [rooms] = await connection.query(roomSql, [roomType]);
        
        if (rooms.length === 0) {
            console.log("No clean rooms found for category:", roomType);
            // This is a specific error we can send to the user
            throw new Error('No rooms available for that category. Please try another room type.');
        }
        const roomNo = rooms[0].Room_No;
        console.log("Found room number:", roomNo);
        
        // --- Step 3: Create the Reservation ---
        // We'll hard-code Hotel_ID = 1, since we only have one demo hotel
        console.log("Step 3: Creating Reservation...");
        const reservationSql = `
            INSERT INTO Reservation (Guest_ID, Hotel_ID, Room_No, Check_In_Date, Check_Out_Date, Status)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        await connection.query(reservationSql, [newGuestID, 1, roomNo, checkIn, checkOut, status]);
        console.log("Reservation created.");
        
        // --- Step 4 (Optional but good): Update the Room status ---
        console.log("Step 4: Updating room status to 'occupied'...");
        const updateRoomSql = "UPDATE Room SET Status = 'occupied' WHERE Room_No = ?";
        await connection.query(updateRoomSql, [roomNo]);
        console.log("Room status updated.");

        // If all steps worked, commit the changes to the database
        await connection.commit();
        console.log("Booking complete! Transaction committed.");
        
        res.status(201).json({ success: true, message: 'Booking created' });

    } catch (error) {
        // If ANY step failed, undo all changes
        await connection.rollback(); 
        console.error("Create Booking API Error:", error);
        
        // Send the specific error message (like "No rooms available...") back to the user
        res.status(500).json({ success: false, message: error.message || 'Server error' });
    } finally {
        // ALWAYS release the connection back to the pool
        connection.release();
    }
});


/**
 * API ENDPOINT: GET /api/bookings
 * Loads all bookings for dashboard.html
 * UPDATED: Uses JOINs to combine data from 4 tables
 */
app.get('/api/bookings', async (req, res) => {
    try {
        // This query JOINS 4 tables to get all the data the dashboard needs
        const sql = `
            SELECT 
                R.Reservation_ID as id, 
                R.Status as status,
                G.Name as name, 
                G.Contact_Info as email, -- Map Contact_Info to 'email' for the dashboard
                H.Name as hotelName, 
                RM.Category as roomType, -- Map Category to 'roomType' for the dashboard
                R.Check_In_Date as checkIn, 
                R.Check_Out_Date as checkOut 
            FROM Reservation R
            JOIN Guest G ON R.Guest_ID = G.Guest_ID
            JOIN Hotel H ON R.Hotel_ID = H.Hotel_ID
            JOIN Room RM ON R.Room_No = RM.Room_No
            ORDER BY R.Reservation_ID DESC
        `;
        const [bookings] = await pool.query(sql);
        
        res.json(bookings);
        
    } catch (error) {
        console.error("Get Bookings API Error:", error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


/**
 * API ENDPOINT: PATCH /api/bookings/:id
 * Updates a booking's status from dashboard.html
 * UPDATED: Works on the 'Reservation' table
 */
app.patch('/api/bookings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        // Use the new Primary Key 'Reservation_ID'
        const sql = "UPDATE Reservation SET Status = ? WHERE Reservation_ID = ?";
        
        await pool.query(sql, [status, id]);
        
        res.json({ success: true, message: 'Booking status updated' });
        
    } catch (error) {
        console.error("Update Booking API Error:", error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


/**
 * API ENDPOINT: GET /api/rooms
 * Loads all room statuses for dashboard.html
 * UPDATED: Queries the new 'Room' table
 */
app.get('/api/rooms', async (req, res) => {
    try {
        // Map Room_No -> id and Category -> name for the dashboard
        // We also add the 'Rent' price
        const sql = "SELECT Room_No as id, Category as name, Status, Rent FROM Room"; 
        const [rooms] = await pool.query(sql);
        
        res.json(rooms);
        
    } catch (error) {
        console.error("Get Rooms API Error:", error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


/**
 * API ENDPOINT: PATCH /api/rooms/:id
 * Updates a room's status from dashboard.html
 * UPDATED: Works on the 'Room' table
 */
app.patch('/api/rooms/:id', async (req, res) => {
    try {
        const { id } = req.params; // This is the Room_No
        const { status } = req.body;
        
        // Use the new Primary Key 'Room_No'
        const sql = "UPDATE Room SET Status = ? WHERE Room_No = ?";
        
        await pool.query(sql, [status, id]);
        
        res.json({ success: true, message: 'Room status updated' });
        
    } catch (error) {
        console.error("Update Room API Error:", error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


// --- 5. Verify DB connection, then start server ---
async function startServer() {
    let connection;

    try {
        connection = await pool.getConnection();
        await connection.ping();
        console.log("Database connected successfully.");

        app.listen(port, () => {
            console.log(`Backend server running at http://localhost:${port}`);
        });
    } catch (error) {
        console.error("Database connection failed:", error.message);
        process.exit(1);
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

startServer();