const { google } = require("googleapis");
const User = require("../models/User"); // This might be needed for token refresh later

const getCourses = async (req, res) => {
  try {
    // Check for user and token. The route uses 'accessToken'.
    if (!req.user || !req.user.accessToken) {
      return res.status(401).json({ message: "Google account is not connected or token is missing." });
    }

    // Set up Google API client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    
    console.log(`[classroomController] User ${req.user._id} - refreshToken from req.user: ${req.user.refreshToken ? 'exists' : 'MISSING'}`);
    oauth2Client.setCredentials({
      access_token: req.user.accessToken,
      refresh_token: req.user.refreshToken, // Important for expired tokens
    });

    // Add event listener to refresh tokens and save them to the database
    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.refresh_token) {
        req.user.refreshToken = tokens.refresh_token;
      }
      req.user.accessToken = tokens.access_token;
      // Save the updated user with new tokens to the database
      try {
        await req.user.save();
        console.log("Tokens refreshed and saved for user:", req.user._id);
      } catch (dbErr) {
        console.error("Failed to save refreshed tokens for user:", req.user._id, dbErr);
      }
    });

    const classroom = google.classroom({ version: 'v1', auth: oauth2Client });

    // Fetch all pages of courses
    const fetchAllCourses = async () => {
      let courses = [];
      let pageToken = null;

      do {
        const response = await classroom.courses.list({
          courseStates: ["ACTIVE"],
          studentId: 'me',
          pageSize: 50, // A reasonable page size
          pageToken: pageToken,
        });
        if (response.data.courses) {
          courses = courses.concat(response.data.courses);
        }
        pageToken = response.data.nextPageToken;
      } while (pageToken);
      return courses;
    };

    const courses = await fetchAllCourses();
    res.status(200).json(courses || []);

  } catch (err) {
    console.error("Classroom API error:", err.message);
    
    // Handle token expiration
    if (err.code === 401) {
      // In a real app, you'd use the refresh_token here to get a new access_token,
      // update the user record in the DB, and retry the request.
      return res.status(401).json({ message: "Authentication token is invalid. Re-login may be required." });
    }
    
    res.status(500).json({ message: "Failed to request Classroom API", error: err.message });
  }
};

module.exports = {
  getCourses,
};
