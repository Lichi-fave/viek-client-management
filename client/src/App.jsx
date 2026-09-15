import { useEffect, useState } from "react";

const API_URL = "http://localhost:4000/api";

function App() {
  const [token, setToken] = useState(localStorage.getItem("token"));

  const [email, setEmail] = useState("admin@viek.test");

  const [password, setPassword] = useState("password123");

  const [clients, setClients] = useState([]);

  const [projects, setProjects] = useState([]); // BUG FIX: was useSate() -> undefined, crashed on .map()

  const [selectedClient, setSelectedClient] = useState("");

  const [clientName, setClientName] = useState("");

  const [clientEmail, setClientEmail] = useState("");

  const [message, setMessage] = useState("");

  async function login(event) {
    event.preventDefault();

    const response = await fetch(`${API_URL}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      setMessage(result.message);
      return;
    }

    localStorage.setItem("token", result.token);
    setToken(result.token);
  }

  async function loadClients() {
    const response = await fetch(`${API_URL}/clients`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (response.status === 401) {
      // BUG FIX: stale/invalid token was never handled, app would silently break
      handleSessionExpired();
      return;
    }

    const result = await response.json();
    setClients(result.data); // BUG FIX : backend returns { data } not { clients }
  }

  async function loadProjects() {
    const url = selectedClient
      ? `${API_URL}/projects?clientId=${selectedClient}`
      : `${API_URL}/projects`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (response.status === 401) {
      handleSessionExpired();
      return;
    }

    const result = await response.json();

    setProjects(result.projects);
  }

  async function addClient(event) {
    event.preventDefault();

    const response = await fetch(`${API_URL}/clients`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", // BUG FIX : was missing, req.body was undefined server-side
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: clientName,
        email: clientEmail,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      setMessage(result.message);
      return;
    }

    setMessage("Client added successfully");

    setClientName("");
    setClientEmail("");

    loadClients();
  }

  async function deleteClient(id) {
    const response = await fetch(`${API_URL}/clients/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const result = await response.json();

    setMessage(result.message);

    if (response.ok) {
      loadClients();
    }
  }

  function handleSessionExpired() {
    localStorage.removeItem("token");
    setToken(null);
    setMessage("Session expired or invalid. Please log in again.");
  }

  function logout() {
    localStorage.removeItem("token");
    setToken(null);
    setClients([]);
    setProjects([]);
    setMessage(""); // clear leftover message
  }

  useEffect(() => {
    if (token) {
      loadClients();
      loadProjects();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedClient]);

  if (!token) {
    return (
      <div className="container">
        <div className="card">
          <h1>VIEK Client Management</h1>

          <h2>Login</h2>

          <form onSubmit={login}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
            />

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
            />

            <button type="submit">Login</button>
          </form>

          {message && <p className="message">{message}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header-row">
        <h1>VIEK Client Management</h1>
        <button className="logout-btn" onClick={logout}>
          Logout
        </button>
      </div>

      <div className="card">
        <h2>Add Client</h2>

        <form onSubmit={addClient}>
          <input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Client name"
          />

          <input
            type="email"
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            placeholder="Client email"
          />

          <button type="submit">Add Client</button>
        </form>

        {message && <p className="message">{message}</p>}
      </div>

      <div className="card">
        <h2>Clients</h2>

        {clients.length === 0 ? (
          <p>No clients found.</p>
        ) : (
          <ul>
            {clients.map((client) => (
              <li key={client.id}>
                <strong>{client.name}</strong>
                <span>{client.email}</span>

                <button onClick={() => deleteClient(client.id)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Projects</h2>

        <select
          value={selectedClient}
          onChange={(e) => setSelectedClient(e.target.value)}
        >
          <option value="">All Clients</option>

          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
        {projects.length === 0 ? (
          <p>No projects found.</p>
        ) : (
          <ul>
            {projects.map((project) => (
              <li key={project.id}>
                <strong>{project.name}</strong>

                <span>Client ID: {project.clientId}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default App;
