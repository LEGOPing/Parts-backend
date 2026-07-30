import SwiftUI
import CoreData

// 获取类别名称
func getCategoryName(for categoryId: Int32) -> String {
    let persistence = PersistenceController.shared
    let rbPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
    rbPrivateContext.parent = persistence.rbContainer.viewContext
    
    var categoryName = "未定义"
    
    rbPrivateContext.performAndWait { 
        let categoryFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts_categories")
        categoryFetchRequest.predicate = NSPredicate(format: "id == %d", categoryId)
        
        do {
            let categories = try rbPrivateContext.fetch(categoryFetchRequest)
            if let category = categories.first {
                if let name = category.value(forKey: "name") as? String {
                    categoryName = name
                }
            }
        } catch {
            print("Error fetching category: \(error)")
        }
    }
    
    return categoryName
}

// 获取颜色名称
func getColorName(for colorId: Int32) -> String {
    let persistence = PersistenceController.shared
    let rbPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
    rbPrivateContext.parent = persistence.rbContainer.viewContext
    
    var colorName = "未定义"
    
    rbPrivateContext.performAndWait { 
        let colorFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Colors")
        colorFetchRequest.predicate = NSPredicate(format: "id == %d", colorId)
        
        do {
            let colors = try rbPrivateContext.fetch(colorFetchRequest)
            if let color = colors.first {
                if let name = color.value(forKey: "name") as? String {
                    colorName = name
                }
            }
        } catch {
            print("Error fetching color: \(error)")
        }
    }
    
    return colorName
}

// 获取位置文本
func getLocationText(for part: NSManagedObject) -> String {
    if let box = part.getBox() {
        // 盒子信息
        let boxName = box.value(forKey: "name") as? String ?? "未命名盒子"
        
        // 仓库信息
        var locationText = "位置: "
        if let repository = box.value(forKey: "repository") as? NSManagedObject {
            let repoName = repository.value(forKey: "name") as? String ?? "未命名仓库"
            locationText += "\(repoName)_\(boxName)"
        } else {
            locationText += boxName
        }
        
        return locationText
    } else {
        return "位置: 未分配"
    }
}

// 从RB数据库根据颜色ID获取颜色名称
func getColorName(from colorId: Int32) -> String? {
    let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Colors")
    fetchRequest.predicate = NSPredicate(format: "id == %d", colorId)
    
    let persistence = PersistenceController.shared
    let colors = try? persistence.rbContainer.viewContext.fetch(fetchRequest)
    
    if let color = colors?.first, let colorName = color.value(forKey: "name") as? String {
        return colorName
    }
    return nil
}

// 移除字符串中的所有空格
func removeAllSpaces(_ text: String) -> String {
    return text.replacingOccurrences(of: " ", with: "")
}
