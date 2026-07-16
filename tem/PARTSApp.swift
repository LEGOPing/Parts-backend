//
//  PARTSApp.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/13.
//

import SwiftUI
import CoreData

@main
struct PARTSApp: App {
    let persistenceController = PersistenceController.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.managedObjectContext, persistenceController.container.viewContext)
        }
    }
}
